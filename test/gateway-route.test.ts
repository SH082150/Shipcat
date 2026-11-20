import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRoutes, planUpstream } from "../core/gateway/3-route-out/index.ts";
import type { RouteTable } from "../core/gateway/3-route-out/index.ts";
import { GatewayError, errorBody, sendError } from "../core/gateway/errors/index.ts";
import type { Provider } from "../core/types.ts";

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    version: 1,
    inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic",
    inferenceGatewayApiKey: "sk-deepseek-xxxxxxxx",
    inferenceGatewayAuthScheme: "x-api-key",
    ...overrides,
  };
}

/** 默认解析器：u-1 → DeepSeek（x-api-key），u-2 → Kimi（bearer）。 */
function resolveProvider(uuid: string): Provider | null {
  if (uuid === "u-1") return makeProvider();
  if (uuid === "u-2") {
    return makeProvider({
      inferenceGatewayBaseUrl: "https://api.moonshot.cn/anthropic/",
      inferenceGatewayApiKey: "sk-kimi-yyyyyyyy",
      inferenceGatewayAuthScheme: "bearer",
    });
  }
  return null;
}

const ENTRIES = [
  { name: "claude-sonnet-main", provider: "u-1", upstreamModel: "deepseek-chat" },
  { name: "claude-opus-kimi", provider: "u-2", upstreamModel: "kimi-k2" },
] as const;

function makeTable(): RouteTable {
  return buildRoutes(ENTRIES, resolveProvider);
}

function msg(body: Record<string, unknown>): { body: Buffer } {
  return { body: Buffer.from(JSON.stringify(body), "utf8") };
}

const BASE_BODY = {
  model: "claude-sonnet-main",
  max_tokens: 8192,
  system: [{ type: "text", text: "你是助手" }],
  messages: [{ role: "user", content: "你好" }],
  stream: false,
  thinking: { type: "adaptive" },
};

test("假名命中：仅 model 改写为 upstreamModel，其余字段深等价", () => {
  const plan = planUpstream(
    makeTable(),
    msg(BASE_BODY),
    { "anthropic-version": "2023-06-01" },
    "/v1/messages",
    "",
  );
  const sent = JSON.parse(plan.body.toString("utf8")) as Record<string, unknown>;
  assert.equal(sent.model, "deepseek-chat");
  const { model: _sentModel, ...sentRest } = sent;
  const { model: _aliasModel, ...aliasRest } = BASE_BODY;
  assert.deepEqual(sentRest, aliasRest);
});

test("URL = baseUrl 去尾斜杠 + endpoint + query 原样保留", () => {
  const table = makeTable();
  const withQuery = planUpstream(
    table, msg(BASE_BODY), {}, "/v1/messages", "?beta=true",
  );
  assert.equal(withQuery.url, "https://api.deepseek.com/anthropic/v1/messages?beta=true");
  const kimi = planUpstream(
    table,
    msg({ ...BASE_BODY, model: "claude-opus-kimi" }),
    {},
    "/v1/messages/count_tokens",
    "",
  );
  assert.equal(kimi.url, "https://api.moonshot.cn/anthropic/v1/messages/count_tokens");
});

test("查无路由：404 not_found_error，中文消息带模型名", () => {
  assert.throws(
    () => planUpstream(makeTable(), msg({ ...BASE_BODY, model: "claude-unknown" }), {}, "/v1/messages", ""),
    (err: unknown) => {
      assert.ok(err instanceof GatewayError);
      assert.equal(err.status, 404);
      assert.equal(err.type, "not_found_error");
      assert.match(err.message, /claude-unknown/);
      return true;
    },
  );
});

test("x-api-key scheme：换供应商 key，Desktop 的 token 被丢弃", () => {
  const plan = planUpstream(
    makeTable(),
    msg(BASE_BODY),
    { authorization: "Bearer claudeharbor-local", "x-api-key": "claudeharbor-local" },
    "/v1/messages",
    "",
  );
  assert.equal(plan.headers["x-api-key"], "sk-deepseek-xxxxxxxx");
  assert.equal(plan.headers["authorization"], undefined);
  assert.equal(plan.headers["host"], undefined);
});

test("bearer scheme：构 Authorization: Bearer <apiKey>", () => {
  const plan = planUpstream(
    makeTable(),
    msg({ ...BASE_BODY, model: "claude-opus-kimi" }),
    { authorization: "Bearer claudeharbor-local" },
    "/v1/messages",
    "",
  );
  assert.equal(plan.headers["authorization"], "Bearer sk-kimi-yyyyyyyy");
  assert.equal(plan.headers["x-api-key"], undefined);
});

test("customHeaders 透传且去重托管头与 hop-by-hop", () => {
  const plan = planUpstream(
    makeTable(),
    msg(BASE_BODY),
    {},
    "/v1/messages",
    "",
    {
      "x-foo": "bar",
      "X-API-Key": "should-be-dropped",
      "host": "evil.example",
      "connection": "keep-alive",
      "transfer-encoding": "chunked",
    },
  );
  assert.equal(plan.headers["x-foo"], "bar");
  assert.equal(plan.headers["x-api-key"], "sk-deepseek-xxxxxxxx"); // 未被透传块覆盖
  assert.equal(plan.headers["host"], undefined);
  assert.equal(plan.headers["connection"], undefined);
  assert.equal(plan.headers["transfer-encoding"], undefined);
});

test("anthropic-version 缺省补 2023-06-01，anthropic-beta 有则透传", () => {
  const defaulted = planUpstream(makeTable(), msg(BASE_BODY), {}, "/v1/messages", "");
  assert.equal(defaulted.headers["anthropic-version"], "2023-06-01");
  assert.equal(defaulted.headers["anthropic-beta"], undefined);

  const passed = planUpstream(
    makeTable(),
    msg(BASE_BODY),
    { "anthropic-version": "2023-06-01", "anthropic-beta": "context-management,effort-2025-11-24" },
    "/v1/messages",
    "",
  );
  assert.equal(passed.headers["anthropic-version"], "2023-06-01");
  assert.equal(passed.headers["anthropic-beta"], "context-management,effort-2025-11-24");
});

test("固定头：accept / accept-encoding / content-type，content-length 重算", () => {
  const plan = planUpstream(makeTable(), msg(BASE_BODY), {}, "/v1/messages", "");
  assert.equal(plan.headers["accept"], "application/json");
  assert.equal(plan.headers["accept-encoding"], "identity");
  assert.equal(plan.headers["content-type"], "application/json");
  assert.equal(plan.headers["content-length"], String(plan.body.length));
});

test("Desktop 其余 anthropic-* / x-claude-code-* 头原样透传，其余头丢弃", () => {
  const plan = planUpstream(
    makeTable(),
    msg(BASE_BODY),
    {
      "x-claude-code-session-id": "sess-1",
      "x-claude-code-request-class": "main",
      "anthropic-organization": "org-xxx",
      "user-agent": "claude-desktop/1.0",
      "cookie": "secret",
    },
    "/v1/messages",
    "",
  );
  assert.equal(plan.headers["x-claude-code-session-id"], "sess-1");
  assert.equal(plan.headers["x-claude-code-request-class"], "main");
  assert.equal(plan.headers["anthropic-organization"], "org-xxx");
  assert.equal(plan.headers["user-agent"], undefined);
  assert.equal(plan.headers["cookie"], undefined);
});

test("buildRoutes：查不到的供应商与空 apiKey 跳过并汇总 warn", () => {
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (line: string) => warnings.push(line);
  try {
    const table = buildRoutes(
      [
        ...ENTRIES,
        { name: "claude-broken", provider: "u-missing", upstreamModel: "m" },
        { name: "claude-nokey", provider: "u-3", upstreamModel: "m" },
      ],
      (uuid: string) => {
        if (uuid === "u-3") return makeProvider({ inferenceGatewayApiKey: "" });
        return resolveProvider(uuid);
      },
    );
    assert.equal(table.size, 2);
    assert.equal(table.has("claude-broken"), false);
    assert.equal(table.has("claude-nokey"), false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /2 条模型路由失效/);
  } finally {
    console.warn = origWarn;
  }
});

test("手动构造的表里 apiKey 为空：502 api_error", () => {
  const table: RouteTable = new Map([
    ["claude-sonnet-main", {
      providerName: "u-1",
      baseUrl: "https://api.deepseek.com/anthropic",
      authScheme: "x-api-key",
      apiKey: "",
      upstreamModel: "deepseek-chat",
    }],
  ]);
  assert.throws(
    () => planUpstream(table, msg(BASE_BODY), {}, "/v1/messages", ""),
    (err: unknown) => {
      assert.ok(err instanceof GatewayError);
      assert.equal(err.status, 502);
      assert.equal(err.type, "api_error");
      return true;
    },
  );
});

test("非法 JSON body：400 invalid_request_error", () => {
  assert.throws(
    () => planUpstream(makeTable(), { body: Buffer.from("not-json") }, {}, "/v1/messages", ""),
    (err: unknown) => {
      assert.ok(err instanceof GatewayError);
      assert.equal(err.status, 400);
      return true;
    },
  );
});

test("GatewayError 走 errors 模块的信封出口（§6 格式）", () => {
  const err = new GatewayError(404, "not_found_error", "没有模型 X 的路由");
  assert.deepEqual(errorBody(err.type, err.message), {
    type: "error",
    error: { type: "not_found_error", message: "没有模型 X 的路由" },
  });

  // sendError：writeHead + JSON body，可直接 end 给客户端。
  const statusCodes: number[] = [];
  const bodies: string[] = [];
  const fakeRes = {
    writeHead(status: number, headers: Record<string, string>) {
      statusCodes.push(status);
      assert.equal(headers["content-type"], "application/json");
    },
    end(body: string) {
      bodies.push(body);
    },
  } as never;
  sendError(fakeRes, err);
  assert.deepEqual(statusCodes, [404]);
  assert.equal(bodies[0], JSON.stringify({
    type: "error",
    error: { type: "not_found_error", message: "没有模型 X 的路由" },
  }));
});
