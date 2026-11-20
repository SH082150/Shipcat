import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateBaseUrl, validateProviderName } from "../core/validate/provider.ts";

describe("validateProviderName", () => {
  it("接受合法名称", () => {
    assert.deepEqual(validateProviderName("deepseek", []), { ok: true });
    assert.deepEqual(validateProviderName("my-provider-2", ["other"]), { ok: true });
  });

  it("拒绝重名", () => {
    const r = validateProviderName("kimi", ["kimi", "deepseek"]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /已存在/);
  });

  it("拒绝空名与超长名", () => {
    assert.equal(validateProviderName("", []).ok, false);
    assert.equal(validateProviderName("a".repeat(33), []).ok, false);
    assert.equal(validateProviderName("a".repeat(32), []).ok, true);
  });

  it("拒绝大写与特殊字符", () => {
    assert.equal(validateProviderName("DeepSeek", []).ok, false);
    assert.equal(validateProviderName("my provider", []).ok, false);
    assert.equal(validateProviderName("中文名", []).ok, false);
    assert.equal(validateProviderName("under_score", []).ok, false);
  });
});

describe("validateBaseUrl", () => {
  it("接受 http/https 端点", () => {
    assert.deepEqual(validateBaseUrl("https://api.deepseek.com/anthropic"), { ok: true });
    assert.deepEqual(validateBaseUrl("http://127.0.0.1:8787"), { ok: true });
    assert.deepEqual(validateBaseUrl("https://api.example.com/a/b/c"), { ok: true });
  });

  it("拒绝非 http/https 协议", () => {
    for (const url of ["ftp://api.example.com", "ws://api.example.com", "//api.example.com"]) {
      const r = validateBaseUrl(url);
      assert.equal(r.ok, false, url);
    }
  });

  it("拒绝查询参数与片段", () => {
    assert.equal(validateBaseUrl("https://api.example.com/?x=1").ok, false);
    assert.equal(validateBaseUrl("https://api.example.com/path#frag").ok, false);
  });

  it("拒绝非法字符串与缺主机名", () => {
    assert.equal(validateBaseUrl("not a url").ok, false);
    assert.equal(validateBaseUrl("api.deepseek.com").ok, false);
  });
});
