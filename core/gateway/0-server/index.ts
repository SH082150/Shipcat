/**
 * 总机：监听 127.0.0.1:port，把每个请求分发到旅程的正确起点。
 *
 * 本层是薄分发：不做解析、不碰 body（交给 1-receive）；自身只产三类响应——
 * base 兜底 200、/health 健康检查（免鉴权）、未知路径 404（均经 errors 信封，
 * 除 health 与 base 这两个非信封端点）。
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { receiveMessage } from "../1-receive/index.ts";
import { authenticate } from "../2-auth/index.ts";
import { buildRoutes, planUpstream, type MessagesEndpoint } from "../3-route-out/index.ts";
import { sendUpstream } from "../4-send/index.ts";
import { receiveUpstream } from "../5-receive-upstream/index.ts";
import { modelsResponse } from "../models/index.ts";
import { handleHello } from "../probe/index.ts";
import { GatewayError, sendError } from "../errors/index.ts";
import type { AdvancedModelEntry, Provider } from "../../types.ts";

/** 启动配置：advanced sidecar 指定端口与密钥，entries 即路由表来源。 */
export interface GatewayOptions {
  /** 监听端口（用户指定，同时只激活一个 profile）。 */
  readonly port: number;
  /** Desktop→网关这一跳的口令（advanced sidecar 的 gatewayToken）。 */
  readonly token: string;
  /** 模型/路由条目（假名 + 供应商引用 + 上游真名），兼作模型清单来源。 */
  readonly entries: readonly AdvancedModelEntry[];
  /** 供应商 UUID → 供应商数据；查不到返回 null（3-route-out 会回 502）。 */
  readonly resolveProvider: (uuid: string) => Provider | null;
  /** profile 透传块 inferenceCustomHeaders，原样追加给上游请求。 */
  readonly customHeaders?: Record<string, string>;
  /** 监听地址，默认 127.0.0.1（回环 only，不暴露局域网）。 */
  readonly host?: string;
}

/** 网关句柄：close() 销毁在途连接并停止监听。 */
export interface GatewayHandle {
  /** 实际监听端口（= 启动入参 port）。 */
  readonly port: number;
  /** 掐断所有在途 socket 后关闭 server。 */
  close(): Promise<void>;
}

type RouteTable = ReturnType<typeof buildRoutes>;

/** 401 统一出口：两个用到鉴权的路径（models / messages）共用。 */
function sendAuthError(res: ServerResponse): void {
  sendError(
    res,
    new GatewayError(401, "authentication_error", "网关 token 无效：请检查 Claude 配置中的网关凭证。"),
  );
}

/** 按「路径 + 方法」查分发表；命中调对应模块，未命中回 404。 */
async function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
  opts: GatewayOptions,
  routes: RouteTable,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (path === "/api/hello" && (method === "HEAD" || method === "GET")) {
    handleHello(req, res);
    return;
  }
  if ((method === "GET" || method === "HEAD") && path === "/") {
    // base 兜底：Desktop 启动可达性检查，200 空体；其余未知路径走 404。
    res.writeHead(200, { "content-length": "0" });
    res.end();
    return;
  }
  if (method === "GET" && path === "/health") {
    // 健康检查：免鉴权，报告路由表有效路由数（构建时被跳过的失效路由不计）。
    const json = JSON.stringify({ status: "ok", routes: routes.size });
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(json),
    });
    res.end(json);
    return;
  }
  if (method === "GET" && path === "/v1/models") {
    if (!authenticate(req.headers, opts.token)) {
      sendAuthError(res);
      return;
    }
    const body = modelsResponse(opts.entries);
    const json = JSON.stringify(body);
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(json),
    });
    res.end(json);
    return;
  }
  if (method === "POST" && (path === "/v1/messages" || path === "/v1/messages/count_tokens")) {
    const received = await receiveMessage(req);
    if (!authenticate(req.headers, opts.token)) {
      sendAuthError(res);
      return;
    }
    const endpoint = path as MessagesEndpoint;
    const plan = planUpstream(routes, { body: received.raw }, req.headers, endpoint, url.search, opts.customHeaders);
    const handle = sendUpstream(plan, {
      // Desktop 中途断开 → 立即掐断上游，防白烧 token。
      onClientGone: (abort) => {
        res.once("close", abort);
      },
    });
    const upstream = await handle.response;
    receiveUpstream(
      { statusCode: upstream.status, headers: upstream.headers, stream: upstream.stream },
      res,
      { requestModel: plan.requestModel },
    );
    return;
  }
  sendError(
    res,
    new GatewayError(404, "not_found_error", `网关没有 ${method} ${path} 这个端点。`),
  );
}

/**
 * 启动网关：构建路由表、起 HTTP server、打印监听地址与路由数。
 * 端口被占 → reject（中文提示，告知换端口）。
 */
export async function startGateway(opts: GatewayOptions): Promise<GatewayHandle> {
  const routes = buildRoutes(opts.entries, opts.resolveProvider);
  const sockets = new Set<Socket>();
  const server: Server = createServer((req, res) => {
    dispatch(req, res, opts, routes).catch((err: unknown) => {
      try {
        if (err instanceof GatewayError) {
          sendError(res, err);
        } else {
          console.error("网关内部错误：", err);
          sendError(res, new GatewayError(500, "api_error", "网关内部错误"));
        }
      } catch {
        // 响应已发出或连接已断：只能销毁。
        res.destroy();
      }
    });
  });
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
  });

  const host = opts.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", (err: Error) => {
      const code = (err as NodeJS.ErrnoException).code;
      reject(
        code === "EADDRINUSE"
          ? new Error(`端口 ${opts.port} 已被占用：请更换端口，或停止占用该端口的进程。`)
          : err,
      );
    });
    server.listen(opts.port, host, () => {
      resolve();
    });
  });

  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : opts.port;
  console.log(`网关已启动：http://${host}:${boundPort}（路由 ${routes.size} 条）`);
  return {
    port: boundPort,
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((err?: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
