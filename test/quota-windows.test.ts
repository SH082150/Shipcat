/**
 * 额度窗口统计：滚动边界、供应商过滤、比率与查询层。
 * 全部使用纯对象或临时目录，不读取真实数据。
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { queryQuotaWindows } from "../core/quota/query.ts";
import { sumQuotaWindows } from "../core/quota/windows.ts";
import type { QuotaRecordLike } from "../core/quota/windows.ts";
import { writeMonitorDay } from "../core/monitor/store.ts";
import type { MonitorRecord } from "../core/monitor/types.ts";
import { localDayStart } from "../core/usage/time.ts";

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);
const HOUR = 3_600_000;
const DAY = 86_400_000;

function usage(input: number, output = 0, cacheRead = 0, cacheWrite = 0) {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    webSearchRequests: 0,
  };
}

function record(ts: number, provider: Record<string, Record<string, ReturnType<typeof usage>>>): QuotaRecordLike {
  return { ts, provider };
}

test("额度窗口：滚动边界与三窗口独立累加", () => {
  const records: QuotaRecordLike[] = [
    record(NOW - 1 * HOUR, { p: { m: usage(10, 1, 100, 1000) } }),
    record(NOW - 5 * HOUR, { p: { m: usage(10, 1, 100, 1000) } }),
    record(NOW - 6 * HOUR, { p: { m: usage(10, 1, 100, 1000) } }),
    record(NOW - 8 * DAY, { p: { m: usage(10, 1, 100, 1000) } }),
    record(NOW - 31 * DAY, { p: { m: usage(10, 1, 100, 1000) } }),
    record(NOW + 1, { p: { m: usage(10, 1, 100, 1000) } }),
  ];

  const [fiveHours, sevenDays, thirtyDays] = sumQuotaWindows(records, { now: NOW });

  assert.equal(fiveHours?.kind, "5h");
  assert.equal(fiveHours?.records, 2);
  assert.equal(fiveHours?.totalTokens, 2 * 1111);
  assert.equal(fiveHours?.start, NOW - 5 * HOUR);

  assert.equal(sevenDays?.records, 3);
  assert.equal(sevenDays?.totalTokens, 3 * 1111);

  assert.equal(thirtyDays?.records, 4);
  assert.equal(thirtyDays?.totalTokens, 4 * 1111);
  assert.equal(thirtyDays?.end, NOW);
});

test("额度窗口：按供应商过滤，多供应商记录只累加选中的 key", () => {
  const records: QuotaRecordLike[] = [
    record(NOW - HOUR, {
      "provider-a": { m: usage(100) },
      "provider-b": { m: usage(7, 3) },
    }),
  ];

  const all = sumQuotaWindows(records, { now: NOW });
  assert.equal(all[0]?.inputTokens, 107);
  assert.equal(all[0]?.records, 1);

  const onlyB = sumQuotaWindows(records, { now: NOW, providers: ["provider-b"] });
  assert.equal(onlyB[0]?.inputTokens, 7);
  assert.equal(onlyB[0]?.outputTokens, 3);
  assert.equal(onlyB[0]?.records, 1);

  const none = sumQuotaWindows(records, { now: NOW, providers: [] });
  assert.equal(none[0]?.records, 0);
  assert.equal(none[0]?.totalTokens, 0);

  const missing = sumQuotaWindows(records, { now: NOW, providers: ["unknown"] });
  assert.equal(missing[0]?.records, 0);
});

test("额度窗口：命中率与输入输出占比", () => {
  const records: QuotaRecordLike[] = [
    record(NOW - HOUR, { p: { m: usage(100, 50, 300, 100) } }),
  ];
  const [window] = sumQuotaWindows(records, { now: NOW });
  assert.ok(window);
  assert.equal(window.totalTokens, 550);
  assert.equal(window.cacheHitRate, 300 / 500);
  assert.equal(window.inputShare, 500 / 550);
  assert.equal(window.outputShare, 50 / 550);

  const empty = sumQuotaWindows([], { now: NOW });
  assert.equal(empty[0]?.totalTokens, 0);
  assert.equal(empty[0]?.cacheHitRate, null);
  assert.equal(empty[0]?.inputShare, null);
  assert.equal(empty[0]?.outputShare, null);
});

test("额度查询：读取 Monitor 日文件并给出去重后的窗口汇总", () => {
  const root = mkdtempSync(join(tmpdir(), "shipcat-quota-"));
  try {
    const older = NOW - 2 * HOUR;
    const recent = NOW - HOUR;
    const toMonitor = (ts: number, input: number): MonitorRecord => ({
      v: 2,
      id: `id-${ts}`,
      ts,
      surface: "code",
      origin: "turn",
      sessionId: null,
      isError: false,
      provider: { p: { m: usage(input) } },
      tools: {},
    });
    writeMonitorDay(root, localDayStart(recent, "UTC"), [
      toMonitor(recent, 20),
      toMonitor(older, 10),
    ]);

    const snapshot = queryQuotaWindows(root, { now: NOW, limit: 100 });
    assert.equal(snapshot.windows[0]?.inputTokens, 30);
    assert.equal(snapshot.windows[0]?.records, 2);
    assert.equal(snapshot.coverageStart, older);
    assert.equal(snapshot.truncated, false);

    const capped = queryQuotaWindows(root, { now: NOW, limit: 1 });
    assert.equal(capped.truncated, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("额度视图：按 resetAt 生成 Layer 2 区间并只统计绑定供应商", async () => {
  const { buildLimitView } = await import("../core/quota/limit.ts");
  const resetAt = NOW + 2 * HOUR;
  const view = buildLimitView({
    profileId: "lp",
    providerId: "p1",
    outcome: {
      queryId: "lp",
      providerId: "p1",
      ok: true,
      fetchedAt: NOW,
      result: {
        windows: {
          "5h": { used: 3, limit: 10, remaining: 7, resetAt, unit: "tokens" },
        },
        balance: { amount: 12, currency: "CNY" },
      },
    },
    records: [
      record(resetAt - HOUR, { p1: { m: usage(100) }, p2: { m: usage(50) } }),
      record(resetAt - 6 * HOUR, { p1: { m: usage(999) } }),
    ],
  });

  assert.equal(view.ok, true);
  assert.equal(view.windows.length, 1);
  const window = view.windows[0];
  assert.ok(window);
  assert.deepEqual(window.range, { start: resetAt - 5 * HOUR, end: resetAt });
  assert.equal(window.local?.totalTokens, 100);
  assert.equal(window.local?.records, 1);
  assert.equal(view.balance?.amount, 12);

  const noReset = buildLimitView({
    profileId: "lp",
    providerId: "p1",
    outcome: {
      queryId: "lp",
      providerId: "p1",
      ok: true,
      fetchedAt: NOW,
      result: { windows: { "7d": { remaining: 1, unit: "percent" } } },
    },
    records: [],
  });
  assert.equal(noReset.windows[0]?.range, null);
  assert.equal(noReset.windows[0]?.local, null);
});
