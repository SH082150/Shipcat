/**
 * 回程链路（5-receive-upstream → 6-route-back → 7-reply）自测。
 * 起一个真实 HTTP 上游服务器；网关侧由真实 http.Server 充当，处理器
 * 里站在 4-send 的位置（http.request 收到响应后）调用 receiveUpstream，
 * 让回程三站拿到真实的 IncomingMessage / ServerResponse / socket。
 * 对照样本：docs/gateway-formats.md §5.2（SSE 序列）、§9（JSON 旅程）、
 * §10（流式旅程：逐块管道、ping 不得剥离）。
 */

import assert from "node:assert/strict";
import http from "node:http";
import type { IncomingHttpHeaders, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { after, describe, test } from "node:test";

import {
  receiveUpstream,
  type UpstreamResponse,
} from "../core/gateway/5-receive-upstream/index.ts";
import { filterResponseHeaders } from "../core/gateway/6-route-back/index.ts";
import { GatewayError } from "../core/gateway/errors/index.ts";

/** gateway-formats.md §5.2 的完整 SSE 事件序列（含长思考时的 ping）。 */
const SSE_EVENTS: readonly string[] = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01ABC...","type":"message","role":"assistant","model":"deepseek-chat","content":[],"stop_reason":null,"usage":{"input_tokens":25,"output_tokens":0}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"用户"}}\n\n',
  'event: ping\ndata: {"type":"ping"}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"在问"}}\n\n',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"你好"}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"！我是"}}\n\n',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  "data: [DONE]\n\n",
];

/** §5.1/§9 的非流式消息体（上游真名 deepseek-chat 原样）。 */
const JSON_MESSAGE =
  '{"id":"msg_01ABC...","type":"message","role":"assistant","model":"deepseek-chat",' +
  '"content":[{"type":"thinking","thinking":"用户在问..."},{"type":"text","text":"你好！我是..."}],' +
  '"stop_reason":"end_turn","usage":{"input_tokens":25,"output_tokens":42,' +
  '"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}';

/** §6 上游错误原文（透传，不经网关信封）。 */
const UPSTREAM_500_BODY =
  '{"type":"error","error":{"type":"api_error","message":"上游供应商内部错误"}}';

interface Servers {
  upstream: Server;
  gateway: Server;
  upstreamPort: number;
  gatewayPort: number;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

/**
 * 起"上游 + 网关"对。网关处理器站在 4-send 的位置：转发请求给上游，
 * 收到响应后交给 receiveUpstream（5→6→7 回程链），socket 全真。
 */
async function startPair(upstreamHandler: http.RequestListener): Promise<Servers> {
  const upstream = http.createServer(upstreamHandler);
  await listen(upstream);
  const upstreamPort = (upstream.address() as AddressInfo).port;
  const gateway = http.createServer((clientReq, clientRes) => {
    const upstreamReq = http.request(
      {
        host: "127.0.0.1",
        port: upstreamPort,
        path: clientReq.url,
        method: clientReq.method,
        headers: clientReq.headers,
      },
      (upstreamRes) => {
        receiveUpstream(upstreamRes, clientRes);
      },
    );
    upstreamReq.on("error", () => {
      clientRes.destroy();
    });
    clientReq.pipe(upstreamReq);
  });
  await listen(gateway);
  const gatewayPort = (gateway.address() as AddressInfo).port;
  return { upstream, gateway, upstreamPort, gatewayPort };
}

interface Got {
  status: number;
  headers: IncomingHttpHeaders;
  chunks: Buffer[];
  body: Buffer;
}

/** GET 网关，收集逐块 data 事件与拼合字节。 */
function get(port: number, path = "/"): Promise<Got> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          chunks,
          body: Buffer.concat(chunks),
        }),
      );
    });
    req.on("error", reject);
  });
}

/** 本文件起过的所有服务器对，after 里统一关。 */
const started: Servers[] = [];

after(async () => {
  await Promise.all(
    started.flatMap((s) => [close(s.upstream), close(s.gateway)]),
  );
  started.length = 0;
});

describe("5-receive-upstream 防御", () => {
  test("响应缺失 → GatewayError 502 api_error", () => {
    assert.throws(
      () => receiveUpstream(null, {} as ServerResponse),
      (err: unknown) =>
        err instanceof GatewayError && err.status === 502 && err.type === "api_error",
    );
  });

  test("响应不完整（无数据流）→ GatewayError 502 api_error", () => {
    const broken = { statusCode: 200, headers: {} } as unknown as UpstreamResponse;
    assert.throws(
      () => receiveUpstream(broken, {} as ServerResponse),
      (err: unknown) =>
        err instanceof GatewayError && err.status === 502 && err.type === "api_error",
    );
  });
});

describe("6-route-back 滤头", () => {
  test("hop-by-hop 全滤、业务头原样保留", () => {
    const filtered = filterResponseHeaders({
      "content-type": "text/event-stream",
      "transfer-encoding": "chunked",
      connection: "keep-alive",
      "keep-alive": "timeout=5",
      "proxy-authenticate": 'Basic realm="up"',
      "proxy-authorization": "Basic dXA6",
      te: "trailers",
      trailer: "x-checksum",
      upgrade: "h2c",
      "x-should-retry": "true",
      "retry-after": "5",
      "anthropic-ratelimit-unified-requests-limit": "1000",
      "anthropic-ratelimit-unified-requests-remaining": "999",
      "request-id": "req_abc",
      "x-custom-orig": "yes",
    });
    assert.deepEqual(filtered, {
      "content-type": "text/event-stream",
      "x-should-retry": "true",
      "retry-after": "5",
      "anthropic-ratelimit-unified-requests-limit": "1000",
      "anthropic-ratelimit-unified-requests-remaining": "999",
      "request-id": "req_abc",
      "x-custom-orig": "yes",
    });
  });
});

describe("回程链路集成（真实上游 + 真实 socket）", () => {
  test("SSE 逐块字节一致（含 ping 不剥离）", async () => {
    const pair = await startPair((_req, res) => {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "x-custom-orig": "yes",
      });
      void (async () => {
        for (const event of SSE_EVENTS) {
          res.write(event);
          await delay(20);
        }
        res.end();
      })();
    });
    started.push(pair);
    const got = await get(pair.gatewayPort, "/v1/messages?beta=true");
    assert.equal(got.status, 200);
    assert.equal(got.headers["content-type"], "text/event-stream");
    assert.equal(got.headers["x-custom-orig"], "yes");
    assert.equal(
      got.body.toString("utf8"),
      SSE_EVENTS.join(""),
      "Desktop 收到的字节必须与 §5.2 事件序列完全一致",
    );
    assert.ok(
      got.chunks.length >= 2,
      `应逐块收到多个 data 事件（实际 ${got.chunks.length} 块）`,
    );
    assert.ok(
      got.body.toString("utf8").includes('event: ping\ndata: {"type":"ping"}'),
      "ping 事件必须原样过境",
    );
  });

  test("非流式 JSON 原样（§9 第 4 步：状态码/业务头/字节）", async () => {
    const pair = await startPair((_req, res) => {
      res.writeHead(200, {
        "content-type": "application/json",
        "request-id": "req_abc",
        "anthropic-ratelimit-unified-requests-limit": "1000",
        "anthropic-ratelimit-unified-requests-remaining": "999",
        "transfer-encoding": "chunked",
      });
      res.end(JSON_MESSAGE);
    });
    started.push(pair);
    const got = await get(pair.gatewayPort, "/v1/messages?beta=true");
    assert.equal(got.status, 200);
    assert.equal(got.body.toString("utf8"), JSON_MESSAGE);
    assert.equal(got.headers["content-type"], "application/json");
    assert.equal(got.headers["request-id"], "req_abc");
    assert.equal(got.headers["anthropic-ratelimit-unified-requests-limit"], "1000");
    assert.equal(got.headers["anthropic-ratelimit-unified-requests-remaining"], "999");
  });

  test("上游 500 原样透传（客户端读错误原文做自动恢复）", async () => {
    const pair = await startPair((_req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(UPSTREAM_500_BODY);
    });
    started.push(pair);
    const got = await get(pair.gatewayPort, "/v1/messages?beta=true");
    assert.equal(got.status, 500, "上游状态码原样");
    assert.equal(got.body.toString("utf8"), UPSTREAM_500_BODY, "错误原文逐字节原样");
  });

  test("Desktop 中途断开 → 上游被掐断（上游服务器感知 close）", async () => {
    let notifyClose: (() => void) | undefined;
    const upstreamSawClose = new Promise<void>((resolve) => {
      notifyClose = resolve;
    });
    const pair = await startPair((_req, res) => {
      res.on("error", () => {});
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.on("close", () => {
        // 响应没写完连接就断 = 客户端掐断（掐断生效）；正常 end 完的不算。
        if (!res.writableEnded) notifyClose?.();
      });
      void (async () => {
        for (const event of SSE_EVENTS) {
          res.write(event);
          await delay(50);
        }
        res.end();
      })();
    });
    started.push(pair);

    // Desktop 侧：收到第一块就 destroy 自己（模拟用户按停止）。
    await new Promise<void>((resolve, reject) => {
      const req = http.get(
        { host: "127.0.0.1", port: pair.gatewayPort, path: "/v1/messages?beta=true" },
        (res) => {
          res.on("error", () => {});
          res.once("data", () => {
            req.destroy();
            resolve();
          });
        },
      );
      req.on("error", reject);
    });

    await Promise.race([
      upstreamSawClose,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("上游未感知到客户端断开（掐断未生效）")), 3000),
      ),
    ]);
  });
});
