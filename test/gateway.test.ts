import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createServer,
  request as httpRequest,
  type RequestOptions,
  type Server,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { format } from "node:util";
import type { TestContext } from "node:test";

import type { AdvancedModelEntry, Provider } from "../core/types.ts";
import { add as addProvider } from "../core/archive/providers/index.ts";
import { create as createProfile } from "../core/archive/profiles/index.ts";
import { claudePaths } from "../core/archive/paths/index.ts";
import { runGatewayRun } from "../scripts/gateway-run.ts";

// ---------- Windows 上 node 测试运行器的已知缺陷规避 ----------
//
// node 24.11 的测试运行器把子进程的 v8 序列化帧和普通 stdout 混在同一个管道里
// 解析，且帧长度按有符号 32 位读取（nodejs/node#64061，后续 24.x 已修复）。
// 一旦普通日志紧跟在某个协议帧之后，非 ASCII 字节（中文/emoji 的 UTF-8 首字节
// 均 >= 0x80）就会被当成负的帧长度，整个文件直接报
// 「Unable to deserialize cloned data due to invalid or unsupported version」，
// 表现为随机某个用例处中断，单跑本文件又可能通过。
//
// 网关启动横幅（core/gateway/0-server 的「网关已启动：…」）是中文且必然打印，
// 因此这里把 console.log 改道到 stderr：stderr 由运行器按行转发、不参与协议
// 解析，日志照常可见，用例断言不受影响。console.warn/error 本来就写 stderr。
console.log = (...args: unknown[]): void => {
  process.stderr.write(`${format(...args)}\n`);
};

// ---------- startGateway 接口面（与 scripts/gateway-run.ts 同一份结构类型） ----------

type StartGatewayFn = (opts: {
  readonly port: number;
  readonly token: string;
  readonly entries: readonly AdvancedModelEntry[];
  readonly resolveProvider: (providerId: string) => Provider | undefined;
  readonly customHeaders?: Record<string, string>;
}) => Promise<{ readonly port: number; close(): unknown }>;

  /** core/gateway/0-server 未导出 startGateway 时为 undefined。 */
let startGateway: StartGatewayFn | undefined;
try {
  const mod = (await import("../core/gateway/0-server/index.ts")) as Record<string, unknown>;
  if (typeof mod.startGateway === "function") startGateway = mod.startGateway as StartGatewayFn;
} catch {
  startGateway = undefined;
}

/** 用例入口：未就绪则 skip 并中断执行。 */
function needGateway(t: TestContext): StartGatewayFn {
  if (startGateway === undefined) {
    t.skip("内核不可用：core/gateway/0-server 未导出 startGateway");
    throw new Error("unreachable");
  }
  return startGateway;
}

// ---------- 假上游 ----------

interface RecordedReq {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, unknown>;
  readonly body: Buffer;
}

interface Upstream {
  readonly server: Server;
  readonly url: string;
  readonly requests: RecordedReq[];
  /** 累计关闭过的上游 socket 数（掐断检测用）。 */
  socketClosedCount(): number;
}

function startUpstream(onRequest: (rec: RecordedReq, res: ServerResponse) => void): Promise<Upstream> {
  const requests: RecordedReq[] = [];
  let closedSockets = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const rec: RecordedReq = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers as Record<string, unknown>,
        body: Buffer.concat(chunks),
      };
      requests.push(rec);
      onRequest(rec, res);
    });
  });
  server.on("connection", (socket) => {
    socket.on("close", () => {
      closedSockets += 1;
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        requests,
        socketClosedCount: () => closedSockets,
      });
    });
  });
}

async function closeUpstream(upstream: Upstream): Promise<void> {
  (upstream.server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
  await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
}

// ---------- 客户端 ----------

interface RawResponse {
  readonly status: number;
  readonly headers: Record<string, unknown>;
  readonly body: Buffer;
}

function rawRequest(
  port: number,
  opts: { readonly method: string; readonly path: string; readonly headers?: Record<string, string>; readonly body?: string | Buffer },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: opts.path,
        method: opts.method,
        headers: opts.headers,
      } as RequestOptions,
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
        });
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
}

// ---------- 网关夹具 ----------

const TOKEN = "claudeharbor-local";

const ENTRIES: readonly AdvancedModelEntry[] = [
  {
    name: "claude-sonnet-main",
    labelOverride: "DeepSeek 主力",
    supports1m: true,
    provider: "p-deepseek",
    upstreamModel: "deepseek-chat",
  },
  {
    name: "claude-opus-kimi",
    labelOverride: "Kimi K2",
    provider: "p-kimi",
    upstreamModel: "kimi-k2",
  },
  {
    // ⑦ 用：引用的供应商 key 为空，启动构建路由时应被跳过。
    name: "claude-haiku-broken",
    provider: "p-nokey",
    upstreamModel: "some-model",
  },
];

const CUSTOM_HEADERS: Record<string, string> = { "x-harbor-pass": "yes" };

/** 供应商解析：key 为空的 p-nokey 模拟「供应商文件里 key 缺失」。 */
function makeResolveProvider(upstreamUrl: string) {
  return (providerId: string): Provider | undefined => {
    if (providerId === "p-deepseek") {
      return {
        version: 1,
        inferenceGatewayBaseUrl: upstreamUrl,
        inferenceGatewayApiKey: "sk-deepseek-test",
        inferenceGatewayAuthScheme: "x-api-key",
      };
    }
    if (providerId === "p-kimi") {
      return {
        version: 1,
        inferenceGatewayBaseUrl: upstreamUrl,
        inferenceGatewayApiKey: "sk-kimi-test",
        inferenceGatewayAuthScheme: "bearer",
      };
    }
    if (providerId === "p-nokey") {
      return {
        version: 1,
        inferenceGatewayBaseUrl: upstreamUrl,
        inferenceGatewayApiKey: "",
        inferenceGatewayAuthScheme: "x-api-key",
      };
    }
    return undefined;
  };
}

/** 起网关：随机高位端口（30000+），EADDRINUSE 重试；返回实际端口。 */
async function startTestGateway(
  sg: StartGatewayFn,
  upstreamUrl: string,
): Promise<{ readonly gw: { readonly port: number; close(): unknown }; readonly port: number }> {
  let lastErr: unknown;
  for (let i = 0; i < 5; i += 1) {
    const port = 30000 + Math.floor(Math.random() * 20000);
    try {
      const gw = await sg({
        port,
        token: TOKEN,
        entries: ENTRIES,
        resolveProvider: makeResolveProvider(upstreamUrl),
        customHeaders: CUSTOM_HEADERS,
      });
      const actual = typeof gw?.port === "number" ? gw.port : port;
      return { gw, port: actual };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** §5.1 的非流式请求体（其余字段不动断言的基准）。 */
function chatBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: "claude-sonnet-main",
    max_tokens: 8192,
    system: [{ type: "text", text: "你是 ClaudeHarbor 配置的助手。" }],
    messages: [{ role: "user", content: "你好，介绍下你自己" }],
    stream: false,
    thinking: { type: "adaptive" },
    ...overrides,
  };
}

const AUTH_HEADERS = {
  authorization: `Bearer ${TOKEN}`,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "context-management,effort-2025-11-24",
  "content-type": "application/json",
};

// ---------- 集成门槛 ----------

test("集成门槛：core/gateway/0-server 导出 startGateway", () => {
  assert.equal(typeof startGateway, "function", "内核不可用：core/gateway/0-server 未导出 startGateway");
});

// ---------- ① 鉴权双头 ----------

test("① 鉴权：Bearer 与 x-api-key 双头各放行一次，错 token 回 401 信封", async (t) => {
  const sg = needGateway(t);
  const upstream = await startUpstream((_rec, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  const { gw, port } = await startTestGateway(sg, upstream.url);
  t.after(async () => {
    await Promise.resolve(gw.close());
    await closeUpstream(upstream);
  });

  const body = JSON.stringify(chatBody());
  const viaBearer = await rawRequest(port, {
    method: "POST",
    path: "/v1/messages",
    headers: { ...AUTH_HEADERS },
    body,
  });
  assert.equal(viaBearer.status, 200);

  const viaApiKey = await rawRequest(port, {
    method: "POST",
    path: "/v1/messages",
    headers: {
      "x-api-key": TOKEN,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body,
  });
  assert.equal(viaApiKey.status, 200);

  const bad = await rawRequest(port, {
    method: "POST",
    path: "/v1/messages",
    headers: { ...AUTH_HEADERS, authorization: "Bearer wrong-token" },
    body,
  });
  assert.equal(bad.status, 401);
  const env = JSON.parse(bad.body.toString("utf8")) as {
    type: string;
    error: { type: string; message: string };
  };
  assert.equal(env.type, "error");
  assert.equal(env.error.type, "authentication_error");
  assert.equal(typeof env.error.message, "string");
  assert.equal(upstream.requests.length, 2);
});

// ---------- ② model 改写 ----------

test("② model 改写：假名→deepseek-chat、其余字段不动、?beta=true 保留到上游 path", async (t) => {
  const sg = needGateway(t);
  const upstream = await startUpstream((_rec, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg_01ABC", type: "message", model: "deepseek-chat" }));
  });
  const { gw, port } = await startTestGateway(sg, upstream.url);
  t.after(async () => {
    await Promise.resolve(gw.close());
    await closeUpstream(upstream);
  });

  const original = chatBody();
  const res = await rawRequest(port, {
    method: "POST",
    path: "/v1/messages?beta=true",
    headers: { ...AUTH_HEADERS },
    body: JSON.stringify(original),
  });
  assert.equal(res.status, 200);
  assert.equal(upstream.requests.length, 1);

  const rec = upstream.requests[0]!;
  assert.equal(rec.url, "/v1/messages?beta=true");
  const upstreamBody = JSON.parse(rec.body.toString("utf8")) as Record<string, unknown>;
  assert.equal(upstreamBody.model, "deepseek-chat");
  const rest = { ...upstreamBody };
  delete rest.model;
  const originalRest = { ...original };
  delete originalRest.model;
  assert.deepEqual(rest, originalRest);
  assert.equal(rec.headers["x-api-key"], "sk-deepseek-test");
  assert.equal(rec.headers.authorization, undefined);
  assert.equal(rec.headers["anthropic-beta"], "context-management,effort-2025-11-24");
  assert.equal(rec.headers["anthropic-version"], "2023-06-01");
  assert.equal(rec.headers["x-harbor-pass"], "yes");
  assert.equal(rec.headers["content-type"], "application/json");
  assert.equal(Number(rec.headers["content-length"]), rec.body.length);
});

// ---------- ③ 非流式：模型回写 + 头透传 ----------

test("③ 非流式：响应 model 回写为客户端别名，其余字段与头不变", async (t) => {
  const sg = needGateway(t);
  const upstreamBody = JSON.stringify({
    id: "msg_01ABC",
    type: "message",
    role: "assistant",
    model: "deepseek-chat",
    content: [
      { type: "thinking", thinking: "用户在问..." },
      { type: "text", text: "你好！我是..." },
    ],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 25,
      output_tokens: 42,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  });
  const upstream = await startUpstream((_rec, res) => {
    res.writeHead(200, {
      "content-type": "application/json",
      "request-id": "req_abc",
      "anthropic-ratelimit-unified-requests-limit": "1000",
      "anthropic-ratelimit-unified-requests-remaining": "999",
      "x-should-retry": "false",
    });
    res.end(upstreamBody);
  });
  const { gw, port } = await startTestGateway(sg, upstream.url);
  t.after(async () => {
    await Promise.resolve(gw.close());
    await closeUpstream(upstream);
  });

  const res = await rawRequest(port, {
    method: "POST",
    path: "/v1/messages",
    headers: { ...AUTH_HEADERS },
    body: JSON.stringify(chatBody()),
  });
  assert.equal(res.status, 200);
  const parsed = JSON.parse(res.body.toString("utf8")) as Record<string, unknown>;
  assert.equal(parsed.model, "claude-sonnet-main");
  const expected = JSON.parse(upstreamBody) as Record<string, unknown>;
  expected.model = "claude-sonnet-main";
  assert.deepEqual(parsed, expected, "除 model 外响应字段不得变化");
  assert.equal(Number(res.headers["content-length"]), res.body.length, "改写后必须重算 content-length");
  assert.equal(res.headers["request-id"], "req_abc");
  assert.equal(res.headers["anthropic-ratelimit-unified-requests-limit"], "1000");
  assert.equal(res.headers["anthropic-ratelimit-unified-requests-remaining"], "999");
  assert.equal(res.headers["x-should-retry"], "false");
});

// ---------- ④ SSE 逐字节透传 ----------

test("④ 流式：SSE 事件块与 ping 保留，message_start 的 model 回写", async (t) => {
  const sg = needGateway(t);
  // §5.2 的完整事件序列 + 长思考期间的 ping（网关不得剥离）。
  const ssePayload = [
    'event: message_start',
    'data: {"type":"message_start","message":{"id":"msg_01ABC","type":"message","role":"assistant","model":"deepseek-chat","content":[],"stop_reason":null,"usage":{"input_tokens":25,"output_tokens":0}}}',
    "",
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
    "",
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"用户"}}',
    "",
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"在问"}}',
    "",
    'event: ping',
    'data: {}',
    "",
    'event: content_block_stop',
    'data: {"type":"content_block_stop","index":0}',
    "",
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}',
    "",
    'event: message_stop',
    'data: {"type":"message_stop"}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  const upstream = await startUpstream((_rec, res) => {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "anthropic-ratelimit-unified-requests-remaining": "999",
    });
    // 分三块推：第一块切在 message_start 的 data JSON 中间，验证跨块缓冲。
    res.write(ssePayload.slice(0, 60));
    setTimeout(() => {
      res.write(ssePayload.slice(60, 900));
      setTimeout(() => {
        res.end(ssePayload.slice(900));
      }, 25);
    }, 25);
  });
  const { gw, port } = await startTestGateway(sg, upstream.url);
  t.after(async () => {
    await Promise.resolve(gw.close());
    await closeUpstream(upstream);
  });

  const res = await rawRequest(port, {
    method: "POST",
    path: "/v1/messages",
    headers: { ...AUTH_HEADERS },
    body: JSON.stringify(chatBody({ stream: true })),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "text/event-stream");
  assert.equal(res.headers["anthropic-ratelimit-unified-requests-remaining"], "999");
  assert.deepEqual(
    res.body,
    Buffer.from(ssePayload.replace('"model":"deepseek-chat"', '"model":"claude-sonnet-main"'), "utf8"),
    "只允许 message_start 的 model 变化，其余事件字节一致",
  );
  assert.ok(res.body.includes("event: ping\r\ndata: {}\r\n") || res.body.includes("event: ping\ndata: {}\n"));
});

// ---------- ⑤ 客户端中断掐断上游 ----------

test("⑤ 客户端中断：上游 socket 被掐（防白烧 token）", async (t) => {
  const sg = needGateway(t);
  const upstream = await startUpstream((_rec, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('event: message_start\ndata: {"type":"message_start"}\n\n');
    const timer = setInterval(() => {
      try {
        res.write("event: ping\ndata: {}\n\n");
      } catch {
        // socket 已被掐
      }
    }, 100);
    res.on("close", () => clearInterval(timer));
    // 故意不 end：长思考流。
  });
  const { gw, port } = await startTestGateway(sg, upstream.url);
  t.after(async () => {
    await Promise.resolve(gw.close());
    await closeUpstream(upstream);
  });

  const closedBefore = upstream.socketClosedCount();
  await new Promise<void>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/v1/messages",
        method: "POST",
        headers: { ...AUTH_HEADERS },
      } as RequestOptions,
      (res) => {
        res.once("data", () => {
          // Desktop 侧断开。
          req.destroy();
        });
        res.resume();
      },
    );
    req.on("error", () => resolve()); // destroy 触发的 ECONNRESET 属预期
    req.on("close", () => resolve());
    req.on("error", reject); // 占位：node 允许重复监听，首个 resolve 生效
    req.end(JSON.stringify(chatBody({ stream: true })));
  });

  const aborted = await waitFor(() => upstream.socketClosedCount() > closedBefore);
  assert.equal(aborted, true, "客户端断开后上游 socket 应被网关掐断");
});

// ---------- ⑥ 未知假名 404 ----------

test("⑥ 未知假名：404 not_found_error 信封，请求不抵达上游", async (t) => {
  const sg = needGateway(t);
  const upstream = await startUpstream((_rec, res) => {
    res.writeHead(200).end("{}");
  });
  const { gw, port } = await startTestGateway(sg, upstream.url);
  t.after(async () => {
    await Promise.resolve(gw.close());
    await closeUpstream(upstream);
  });

  const res = await rawRequest(port, {
    method: "POST",
    path: "/v1/messages",
    headers: { ...AUTH_HEADERS },
    body: JSON.stringify(chatBody({ model: "claude-unknown-model" })),
  });
  assert.equal(res.status, 404);
  const env = JSON.parse(res.body.toString("utf8")) as { type: string; error: { type: string } };
  assert.equal(env.type, "error");
  assert.equal(env.error.type, "not_found_error");
  assert.equal(upstream.requests.length, 0);
});

// ---------- ⑦ 供应商 key 缺失 → 路由被跳过 ----------

test("⑦ 供应商 key 缺失：buildRoutes 跳过该路由，请求它回 404", async (t) => {
  const sg = needGateway(t);
  const upstream = await startUpstream((_rec, res) => {
    res.writeHead(200).end("{}");
  });
  const { gw, port } = await startTestGateway(sg, upstream.url);
  t.after(async () => {
    await Promise.resolve(gw.close());
    await closeUpstream(upstream);
  });

  const res = await rawRequest(port, {
    method: "POST",
    path: "/v1/messages",
    headers: { ...AUTH_HEADERS },
    body: JSON.stringify(chatBody({ model: "claude-haiku-broken" })),
  });
  assert.equal(res.status, 404);
  const env = JSON.parse(res.body.toString("utf8")) as { type: string; error: { type: string } };
  assert.equal(env.type, "error");
  assert.equal(env.error.type, "not_found_error");
  assert.equal(upstream.requests.length, 0);
});

// ---------- ⑧ 模型发现本地包装 ----------

test("⑧ GET /v1/models：本地包装 id/display_name/description/supports1m，不触上游", async (t) => {
  const sg = needGateway(t);
  const upstream = await startUpstream((_rec, res) => {
    res.writeHead(200).end("{}");
  });
  const { gw, port } = await startTestGateway(sg, upstream.url);
  t.after(async () => {
    await Promise.resolve(gw.close());
    await closeUpstream(upstream);
  });

  const res = await rawRequest(port, {
    method: "GET",
    path: "/v1/models?limit=1000",
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(res.status, 200);
  const listing = JSON.parse(res.body.toString("utf8")) as {
    data: Array<Record<string, unknown>>;
    has_more: boolean;
    first_id: string;
    last_id: string;
  };
  // §11/gateway.md：清单来源 = inferenceModels 全部条目（含坏路由条目——
  // 路由是否有效是请求期的事，发现列表照实展示）。description 缺省 = 假名。
  assert.deepEqual(listing.data, [
    {
      type: "model",
      id: "claude-sonnet-main",
      display_name: "DeepSeek 主力",
      description: "claude-sonnet-main",
      created_at: "2024-01-01T00:00:00Z",
      supports1m: true,
    },
    {
      type: "model",
      id: "claude-opus-kimi",
      display_name: "Kimi K2",
      description: "claude-opus-kimi",
      created_at: "2024-01-01T00:00:00Z",
    },
    {
      type: "model",
      id: "claude-haiku-broken",
      display_name: "claude-haiku-broken",
      description: "claude-haiku-broken",
      created_at: "2024-01-01T00:00:00Z",
    },
  ]);
  assert.equal(listing.has_more, false);
  assert.equal(listing.first_id, "claude-sonnet-main");
  assert.equal(listing.last_id, "claude-haiku-broken");
  assert.equal(upstream.requests.length, 0, "模型发现是纯本地包装，不请求上游");
});

// ---------- ⑨ 预热探针 ----------

test("⑨ HEAD /api/hello 回 200", async (t) => {
  const sg = needGateway(t);
  const upstream = await startUpstream((_rec, res) => {
    res.writeHead(200).end("{}");
  });
  const { gw, port } = await startTestGateway(sg, upstream.url);
  t.after(async () => {
    await Promise.resolve(gw.close());
    await closeUpstream(upstream);
  });

  const res = await rawRequest(port, { method: "HEAD", path: "/api/hello" });
  assert.equal(res.status, 200);
});

// ---------- ⑩ base 路径可达性 ----------

test("⑩ base 路径 GET/HEAD 回 200", async (t) => {
  const sg = needGateway(t);
  const upstream = await startUpstream((_rec, res) => {
    res.writeHead(200).end("{}");
  });
  const { gw, port } = await startTestGateway(sg, upstream.url);
  t.after(async () => {
    await Promise.resolve(gw.close());
    await closeUpstream(upstream);
  });

  const get = await rawRequest(port, { method: "GET", path: "/" });
  assert.equal(get.status, 200);
  const head = await rawRequest(port, { method: "HEAD", path: "/" });
  assert.equal(head.status, 200);
});

// ---------- ⑪ 未知路径 404 ----------

test("⑪ 未知路径回 404 not_found_error 信封", async (t) => {
  const sg = needGateway(t);
  const upstream = await startUpstream((_rec, res) => {
    res.writeHead(200).end("{}");
  });
  const { gw, port } = await startTestGateway(sg, upstream.url);
  t.after(async () => {
    await Promise.resolve(gw.close());
    await closeUpstream(upstream);
  });

  const res = await rawRequest(port, { method: "GET", path: "/no/such/path" });
  assert.equal(res.status, 404);
  const env = JSON.parse(res.body.toString("utf8")) as { type: string; error: { type: string } };
  assert.equal(env.type, "error");
  assert.equal(env.error.type, "not_found_error");
});

// ---------- ⑫ count_tokens ----------

test("⑫ count_tokens：端到端透传上游 {input_tokens}", async (t) => {
  const sg = needGateway(t);
  const upstream = await startUpstream((rec, res) => {
    // §12：第 2 步与聊天同款替换后转给上游（path 保留 count_tokens）。
    assert.ok(rec.url.startsWith("/v1/messages/count_tokens"));
    const body = JSON.parse(rec.body.toString("utf8")) as Record<string, unknown>;
    assert.equal(body.model, "deepseek-chat");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ input_tokens: 42 }));
  });
  const { gw, port } = await startTestGateway(sg, upstream.url);
  t.after(async () => {
    await Promise.resolve(gw.close());
    await closeUpstream(upstream);
  });

  const res = await rawRequest(port, {
    method: "POST",
    path: "/v1/messages/count_tokens",
    headers: { ...AUTH_HEADERS },
    body: JSON.stringify({
      model: "claude-sonnet-main",
      system: "你是一个 helpful 助手",
      messages: [{ role: "user", content: "用一句话解释量子纠缠" }],
    }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body.toString("utf8")), { input_tokens: 42 });
  assert.equal(upstream.requests.length, 1);
});

// ---------- ⑬ 健康检查 ----------

test("⑬ GET /health：免鉴权 200，routes = 路由表有效路由数", async (t) => {
  const sg = needGateway(t);
  const upstream = await startUpstream((_rec, res) => {
    res.writeHead(200).end("{}");
  });
  const { gw, port } = await startTestGateway(sg, upstream.url);
  t.after(async () => {
    await Promise.resolve(gw.close());
    await closeUpstream(upstream);
  });

  const res = await rawRequest(port, { method: "GET", path: "/health" });
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
  const body = JSON.parse(res.body.toString("utf8")) as { status: string; routes: number };
  assert.equal(body.status, "ok");
  // ENTRIES 共 3 条，其中 p-nokey 的 key 为空被构建跳过：有效路由 2 条。
  assert.equal(body.routes, 2);
});

// ---------- scripts/gateway-run.ts 可测面 ----------

test("gateway-run：参数缺失回 2", async () => {
  assert.equal(await runGatewayRun([], {}), 2);
  assert.equal(await runGatewayRun(["a", "b"], {}), 2);
});

test("gateway-run：profile 不存在回 1", async () => {
  const home = mkdtempSync(join(tmpdir(), "harbor-gwrun-"));
  try {
    assert.equal(await runGatewayRun(["不存在的profile"], { home }), 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("gateway-run：standard/readOnly 拒绝（仅 advanced 需要网关）", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "harbor-gwrun-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const provider = addProvider(
    {
      name: "p1",
      inferenceGatewayBaseUrl: "https://example.com/anthropic",
      inferenceGatewayApiKey: "sk-x",
      inferenceGatewayAuthScheme: "x-api-key",
    },
    { home },
  );
  createProfile(
    {
      name: "std",
      mode: "standard",
      inferenceModels: [{ name: "claude-sonnet-main", provider: provider.id }],
    },
    { home },
  );
  assert.equal(await runGatewayRun(["std"], { home }), 1);
});

test("gateway-run：一致性门禁不过 → 拒绝启动（退出 1，提示两侧必须一致）", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "harbor-gwrun-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const provider = addProvider(
    {
      name: "p1",
      inferenceGatewayBaseUrl: "https://example.com/anthropic",
      inferenceGatewayApiKey: "sk-x",
      inferenceGatewayAuthScheme: "x-api-key",
    },
    { home },
  );
  const entry = createProfile(
    {
      name: "adv-gate",
      mode: "advanced",
      port: 45679,
      gatewayToken: "tok",
      inferenceModels: [{ name: "claude-sonnet-main", provider: provider.id, upstreamModel: "deepseek-chat" }],
    },
    { home },
  );
  // 造差异：覆写 Claude 侧 profile 文件（创建即同步的产物被改乱）。
  const libDir = claudePaths(home).configLibrary;
  writeFileSync(
    join(libDir, `${entry.id}.json`),
    JSON.stringify({ inferenceProvider: "gateway", inferenceGatewayApiKey: "tampered" }),
  );

  const errors: string[] = [];
  const origError = console.error;
  console.error = (...a: unknown[]) => {
    errors.push(a.map(String).join(" "));
  };
  let code: number;
  try {
    code = await runGatewayRun(["adv-gate"], { home });
  } finally {
    console.error = origError;
  }
  assert.equal(code, 1);
  assert.ok(
    errors.some((e) => e.includes("网关启动前两侧必须一致")),
    `stderr 应含门禁拒绝语，实际：${errors.join(" | ")}`,
  );
});

test("gateway-run：advanced 而 core 缺 gateway 命名空间 → 中文提示回 0（不阻塞 activate）", async (t) => {
  if (startGateway !== undefined) {
    t.skip("gateway 已交付后此分支不可达（见 gateway-run 的启动路径，需人工联调）");
    return;
  }
  const home = mkdtempSync(join(tmpdir(), "harbor-gwrun-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const provider = addProvider(
    {
      name: "p1",
      inferenceGatewayBaseUrl: "https://example.com/anthropic",
      inferenceGatewayApiKey: "sk-x",
      inferenceGatewayAuthScheme: "x-api-key",
    },
    { home },
  );
  createProfile(
    {
      name: "adv",
      mode: "advanced",
      port: 45678,
      gatewayToken: "tok",
      inferenceModels: [{ name: "claude-sonnet-main", provider: provider.id, upstreamModel: "deepseek-chat" }],
    },
    { home },
  );
  assert.equal(await runGatewayRun(["adv"], { home }), 0);
});
