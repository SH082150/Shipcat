/**
 * 额度配置与用户脚本：档案 CRUD、结果归一、沙箱执行与端到端查询。
 * 全部使用临时目录与注入的 fetch，不访问网络。
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  create,
  getByProvider,
  list,
  update,
} from "../core/archive/limitprofiles/index.ts";
import { add as addProvider } from "../core/archive/providers/index.ts";
import { safeFetch } from "../core/quota/script/http.ts";
import {
  normalizeQuotaResult,
  queryProfileQuota,
  runQuotaScript,
} from "../core/quota/script/run.ts";
import type { QuotaFetch, QuotaHttpResponse } from "../core/quota/script/types.ts";

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);
const SCRIPT = `
  async function query(ctx) {
    const res = await ctx.fetch(ctx.baseUrl + "/balance", {
      headers: { Authorization: "Bearer " + ctx.apiKey },
    });
    const data = res.json();
    return {
      windows: { "5h": { used: 1, limit: 10 } },
      balance: { amount: data.amount, currency: "CNY" },
    };
  }
`;

function response(json: unknown): QuotaHttpResponse {
  const text = JSON.stringify(json);
  return {
    status: 200,
    ok: true,
    headers: { "content-type": "application/json" },
    url: "https://api.example.com/balance",
    text,
    json<T = unknown>(): T {
      return JSON.parse(text) as T;
    },
  };
}

test("额度脚本：结果归一，缺少 remaining 时由 limit - used 推导", () => {
  const result = normalizeQuotaResult({
    windows: {
      "5h": { used: 3, limit: 10 },
      "7d": { remaining: 5, limit: 20 },
    },
    balance: { amount: 12.5, currency: "CNY" },
  });
  assert.equal(result.windows?.["5h"]?.remaining, 7);
  assert.equal(result.windows?.["5h"]?.unit, "tokens");
  assert.equal(result.windows?.["7d"]?.used, 15);
  assert.equal(result.balance?.amount, 12.5);

  assert.throws(() => normalizeQuotaResult({ windows: {} }), /至少一个窗口/);
  assert.throws(
    () => normalizeQuotaResult({ windows: { "5h": { used: 1, unit: "kg" } } }),
    /unit 不合法/,
  );
  assert.throws(() => normalizeQuotaResult({ windows: { "5h": { used: -1 } } }), /非负数字/);
});

test("额度脚本：沙箱执行，凭证由 ctx 注入", async () => {
  let requested: { url: string; auth: string | undefined } | null = null;
  const fakeFetch: QuotaFetch = async (url, init) => {
    requested = { url, auth: init?.headers?.Authorization };
    return response({ amount: 9 });
  };

  const result = await runQuotaScript(
    SCRIPT,
    {
      apiKey: "sk-test",
      baseUrl: "https://api.example.com",
      providerId: "p1",
      now: NOW,
      fetch: fakeFetch,
    },
    { fetch: fakeFetch },
  );

  assert.deepEqual(requested, {
    url: "https://api.example.com/balance",
    auth: "Bearer sk-test",
  });
  assert.equal(result.windows?.["5h"]?.remaining, 9);
  assert.equal(result.balance?.amount, 9);

  await assert.rejects(
    runQuotaScript("const x = 1;", {
      apiKey: "k",
      baseUrl: "https://api.example.com",
      providerId: "p1",
      now: NOW,
      fetch: fakeFetch,
    }),
    /必须定义 async function query/,
  );
});

test("额度脚本：安全请求拒绝非 HTTPS", async () => {
  await assert.rejects(safeFetch("http://api.example.com/balance"), /HTTPS/);
  await assert.rejects(safeFetch("not-a-url"), /不合法/);
});

test("额度配置档案：一供应商一个，名称唯一，支持更新", () => {
  const home = mkdtempSync(join(tmpdir(), "shipcat-limitprofile-"));
  try {
    const provider = addProvider(
      {
        name: "deepseek",
        inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic",
        inferenceGatewayApiKey: "sk-test",
      },
      { home },
    );

    const created = create(
      { name: "DeepSeek 额度", providerId: provider.id, script: SCRIPT },
      { home },
    );
    assert.equal(list({ home }).length, 1);
    assert.equal(getByProvider(provider.id, { home })?.entry.id, created.id);

    assert.throws(
      () => create({ name: "另一个", providerId: provider.id, script: SCRIPT }, { home }),
      /已经有额度配置/,
    );
    assert.throws(
      () => create({ name: "DeepSeek 额度", providerId: provider.id, script: SCRIPT }, { home }),
      /已存在/,
    );

    update(created.id, { name: "DS 额度", enabled: false }, { home });
    const loaded = getByProvider(provider.id, { home });
    assert.equal(loaded?.entry.name, "DS 额度");
    assert.equal(loaded?.profile.enabled, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("额度脚本：端到端执行配置条目", async () => {
  const home = mkdtempSync(join(tmpdir(), "shipcat-quota-run-"));
  try {
    const provider = addProvider(
      {
        name: "deepseek",
        inferenceGatewayBaseUrl: "https://api.example.com",
        inferenceGatewayApiKey: "sk-secret",
      },
      { home },
    );
    const entry = create(
      { name: "Credits", providerId: provider.id, script: SCRIPT },
      { home },
    );
    const loaded = getByProvider(provider.id, { home });
    assert.ok(loaded);

    const fakeFetch: QuotaFetch = async () => response({ amount: 16.5 });
    const outcome = await queryProfileQuota(
      { id: entry.id, ...loaded.profile },
      { home, now: NOW, fetch: fakeFetch },
    );
    assert.equal(outcome.ok, true);
    assert.equal(outcome.result?.balance?.amount, 16.5);

    const disabled = await queryProfileQuota(
      { id: entry.id, ...loaded.profile, enabled: false },
      { home, now: NOW, fetch: fakeFetch },
    );
    assert.equal(disabled.ok, false);
    assert.match(disabled.error ?? "", /禁用/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("额度脚本：子进程执行，同步死循环会超时被 kill", async () => {
  const baseContext = {
    apiKey: "k",
    baseUrl: "https://api.example.com",
    providerId: "p1",
    now: NOW,
    fetch: (() => Promise.reject(new Error("unused"))) as QuotaFetch,
  };

  const ok = await runQuotaScript(
    `async function query() { return { balance: { amount: 2, currency: "CNY" } }; }`,
    baseContext,
    { timeoutMs: 4000 },
  );
  assert.equal(ok.balance?.amount, 2);

  const started = Date.now();
  await assert.rejects(
    runQuotaScript(`async function query() { while (true) {} }`, baseContext, { timeoutMs: 400 }),
    /超时/,
  );
  assert.ok(Date.now() - started < 3000, "同步死循环应在超时后被 kill");
});
