import test from "node:test";
import assert from "node:assert/strict";

import {
  validateRouteId,
  validateStandardProviders,
  validatePort,
  validateGatewayToken,
  validateGatewayAuthScheme,
  validateProviderName,
  validateBaseUrl,
} from "../core/validate/index.ts";

// ---------- validateRouteId：四规则逐条覆盖 ----------

const routeOk = [
  "anthropic-mythos-a", // 契约点名用例
  "claude-sonnet",
  "CLAUDE-OPUS", // 不区分大小写
  "Anthropic-haiku-fast",
  "claude-sonnet-4-6",
  "claude-1234567", // 末尾 7 位数字，不触发日期规则
  "anthropic-opus-2026-x", // 8 位数字不在末尾
  "claude-sonnet-12345678x",
];

const routeFail: [string, string][] = [
  // 规则①：必须含 claude 或 anthropic
  ["gpt-4o", "无 claude/anthropic"],
  ["sonnet-v2", "无 claude/anthropic"],
  // 规则②：厂商黑名单（至少 kimi/glm/deepseek/seed）
  ["claude-sonnet-deepseek", "契约点名用例：deepseek"],
  ["claude-kimi-4", "kimi"],
  ["claude-glm-4.5", "glm"],
  ["claude-seed-1.6", "seed"],
  ["Anthropic-MoonShot-x", "moonshot（黑名单扩展项）"],
  ["claude-qwen-max", "qwen（黑名单扩展项）"],
  // 规则③：末尾 8 位纯数字
  ["claude-sonnet-12345678", "契约点名用例"],
  ["anthropic-opus-20261116", "末尾 8 位数字会被当日期剥掉"],
  // 规则④：长度 1–200、无空白
  ["", "空串"],
  ["claude-" + "x".repeat(194), "201 字符超长"],
  ["claude sonnet", "含空格"],
  ["claude\tsonnet", "含制表符"],
  ["claude\nsonnet", "含换行"],
];

for (const name of routeOk) {
  test(`validateRouteId 通过：${name}`, () => {
    assert.deepEqual(validateRouteId(name), { ok: true });
  });
}

for (const [name, why] of routeFail) {
  test(`validateRouteId 拒绝（${why}）：${JSON.stringify(name)}`, () => {
    const result = validateRouteId(name);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.message.length > 0, "失败须带中文提示");
  });
}

test("validateRouteId 提示语包含修复示例", () => {
  const r = validateRouteId("gpt-4o");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /claude/);
});

// ---------- validateStandardProviders：单供应商规则 ----------

test("validateStandardProviders：单 provider 通过", () => {
  assert.deepEqual(
    validateStandardProviders([{ provider: "u1" }, { provider: "u1" }]),
    { ok: true },
  );
});

test("validateStandardProviders：provider 不一致拒绝", () => {
  const r = validateStandardProviders([{ provider: "u1" }, { provider: "u2" }]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /只直连一家供应商/);
});

test("validateStandardProviders：空 provider 拒绝", () => {
  const r = validateStandardProviders([{ provider: "u1" }, { provider: "" }]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /provider 为空/);
});

test("validateStandardProviders：空数组通过", () => {
  assert.deepEqual(validateStandardProviders([]), { ok: true });
});

// ---------- validatePort ----------

test("validatePort：合法端口通过", () => {
  for (const p of [1, 3456, 65535]) {
    assert.deepEqual(validatePort(p), { ok: true });
  }
});

test("validatePort：越界/非整数拒绝", () => {
  for (const p of [0, 65536, -1, 3.14, Number.NaN]) {
    const r = validatePort(p);
    assert.equal(r.ok, false, `端口 ${p} 应被拒绝`);
    if (!r.ok) assert.ok(r.message.length > 0);
  }
});

// ---------- validateGatewayToken ----------

test("validateGatewayToken：非空通过", () => {
  assert.deepEqual(validateGatewayToken("tok-abc"), { ok: true });
});

test("validateGatewayToken：空串拒绝", () => {
  const r = validateGatewayToken("");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /不能为空/);
});

// ---------- validateGatewayAuthScheme ----------

test("validateGatewayAuthScheme：x-api-key / bearer 通过", () => {
  assert.deepEqual(validateGatewayAuthScheme("x-api-key"), { ok: true });
  assert.deepEqual(validateGatewayAuthScheme("bearer"), { ok: true });
});

test("validateGatewayAuthScheme：其他值拒绝", () => {
  for (const s of ["", "Bearer", "api-key", "basic"]) {
    const r = validateGatewayAuthScheme(s);
    assert.equal(r.ok, false, `方案 ${JSON.stringify(s)} 应被拒绝`);
    if (!r.ok) assert.match(r.message, /x-api-key 或 bearer/);
  }
});

// ---------- validateProviderName：字符集 / 长度 / 查重 ----------

test("validateProviderName：合法名通过", () => {
  assert.deepEqual(validateProviderName("deepseek", []), { ok: true });
  assert.deepEqual(validateProviderName("my-relay-2", ["kimi"]), { ok: true });
});

test("validateProviderName：非法字符拒绝", () => {
  for (const name of ["DeepSeek", "my relay", "my_relay", "深度求索", "a.b", "a/b"]) {
    const r = validateProviderName(name, []);
    assert.equal(r.ok, false, `名字 ${JSON.stringify(name)} 应被拒绝`);
    if (!r.ok) assert.match(r.message, /小写字母、数字和连字符/);
  }
});

test("validateProviderName：空名/超长拒绝", () => {
  assert.equal(validateProviderName("", []).ok, false);
  const r = validateProviderName("a".repeat(65), []);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /32/);
});

test("validateProviderName：重名拒绝", () => {
  const r = validateProviderName("deepseek", ["kimi", "deepseek"]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /已存在/);
});

// ---------- validateBaseUrl：协议 / query / hash ----------

const urlOk = [
  "https://api.deepseek.com/anthropic",
  "http://127.0.0.1:3456", // 本地网关地址（http 允许）
  "https://example.com/", // 尾斜杠归一化归调用方，这里不算错
  "https://example.com/base/path",
];

const urlFail: [string, string][] = [
  ["", "空串"],
  ["not a url", "不是 URL"],
  ["ftp://example.com/anthropic", "非 http/https 协议"],
  ["https://example.com/anthropic?key=1", "带 query"],
  ["https://example.com/anthropic#frag", "带 hash"],
  ["https://user:pass@example.com/anthropic", "内嵌用户名密码"],
];

for (const url of urlOk) {
  test(`validateBaseUrl 通过：${url}`, () => {
    assert.deepEqual(validateBaseUrl(url), { ok: true });
  });
}

for (const [url, why] of urlFail) {
  test(`validateBaseUrl 拒绝（${why}）：${JSON.stringify(url)}`, () => {
    const r = validateBaseUrl(url);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.message.length > 0);
  });
}
