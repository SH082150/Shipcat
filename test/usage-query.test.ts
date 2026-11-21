import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { aggregateUsage, aggregateUsageBuckets } from "../core/usage/index.ts";

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "claudeharbor-usage-query-"));
  mkdirSync(join(home, ".claudeharbor", "usage", "ledger"), { recursive: true });
  return home;
}

/** 本地正午时间戳：无论测试机时区，ts 都落在指定日期的本地天内。 */
function localTs(day: string, hour = 12): number {
  const [year = 1970, month = 1, dayOfMonth = 1] = day.split("-").map(Number);
  return new Date(year, month - 1, dayOfMonth, hour).getTime();
}

/** 造一行官方账本记录。 */
function ledgerLine(ts: number, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    ts,
    surface: "chat",
    origin: "turn",
    isError: false,
    models: {
      "claude-sonnet-9-9": {
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 5,
        cacheWriteTokens: 2,
        webSearchRequests: 0,
        cost: { usd: 0.01, basis: "list" },
      },
    },
    ...overrides,
  });
}

/** 直接写镜像账本文件（查询只读镜像，不经过官方目录）。 */
function writeMirror(home: string, day: string, lines: string[]): void {
  writeFileSync(
    join(home, ".claudeharbor", "usage", "ledger", `${day}.ndjson`),
    `${lines.join("\n")}\n`,
  );
}

/** 构造三天镜像：两天 chat + 一天 code，含多模型行与无 cost 行。 */
function makeHomeWithMirror(): string {
  const home = makeHome();
  writeMirror(home, "2026-11-16", [
    ledgerLine(localTs("2026-11-16"), { origin: "turn" }),
    ledgerLine(localTs("2026-11-16", 13), {
      origin: "title",
      models: {
        "claude-haiku-main": {
          inputTokens: 50,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 1,
          webSearchRequests: 0,
        },
      },
    }),
  ]);
  writeMirror(home, "2026-11-17", [
    ledgerLine(localTs("2026-11-17"), {
      surface: "chat",
      models: {
        "claude-sonnet-9-9": {
          inputTokens: 100,
          outputTokens: 10,
          cacheReadTokens: 5,
          cacheWriteTokens: 2,
          webSearchRequests: 0,
          cost: { usd: 0.01, basis: "list" },
        },
        "claude-haiku-main": {
          inputTokens: 200,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheWriteTokens: 3,
          webSearchRequests: 1,
          cost: { usd: 0.02, basis: "managed" },
        },
      },
    }),
  ]);
  writeMirror(home, "2026-11-18", [
    ledgerLine(localTs("2026-11-18"), { surface: "code", origin: "turn" }),
    ledgerLine(localTs("2026-11-18", 13), { surface: "code", origin: "connection_probe" }),
  ]);
  return home;
}

test("aggregateUsage：无过滤时按天与 surface 聚合并排序", () => {
  const home = makeHomeWithMirror();
  try {
    const result = aggregateUsage({}, { home });

    assert.deepEqual(
      result.map((entry) => [entry.day, entry.surface]),
      [
        ["2026-11-16", "chat"],
        ["2026-11-17", "chat"],
        ["2026-11-18", "code"],
      ],
    );
    const day16 = result[0];
    assert.ok(day16);
    assert.equal(day16.totals.calls, 2);
    assert.equal(day16.totals.inputTokens, 150);
    const sonnet = day16.models["claude-sonnet-9-9"];
    const haiku = day16.models["claude-haiku-main"];
    assert.ok(sonnet);
    assert.ok(haiku);
    assert.equal(sonnet.calls, 1);
    assert.equal(haiku.inputTokens, 50);
    assert.equal(day16.totals.costUsd, 0.01);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("aggregateUsage：day / from-to / surface / origin / model 过滤正确", () => {
  const home = makeHomeWithMirror();
  try {
    const byDay = aggregateUsage({ day: "2026-11-17" }, { home });
    assert.equal(byDay.length, 1);
    const byDayEntry = byDay[0];
    assert.ok(byDayEntry);
    assert.equal(byDayEntry.totals.calls, 1);

    const byRange = aggregateUsage({ from: "2026-11-17", to: "2026-11-18" }, { home });
    assert.deepEqual(byRange.map((entry) => entry.day), ["2026-11-17", "2026-11-18"]);

    const bySurface = aggregateUsage({ surface: "code" }, { home });
    assert.deepEqual(bySurface.map((entry) => entry.surface), ["code"]);
    const bySurfaceEntry = bySurface[0];
    assert.ok(bySurfaceEntry);
    assert.equal(bySurfaceEntry.totals.calls, 2);

    const byOrigin = aggregateUsage({ origin: "connection_probe" }, { home });
    assert.equal(byOrigin.length, 1);
    const byOriginEntry = byOrigin[0];
    assert.ok(byOriginEntry);
    assert.equal(byOriginEntry.totals.calls, 1);
    assert.equal(byOriginEntry.totals.inputTokens, 100);

    const byModel = aggregateUsage({ model: "claude-haiku-main" }, { home });
    assert.equal(byModel.length, 2);
    const haikuDay16 = byModel[0];
    const haikuDay17 = byModel[1];
    assert.ok(haikuDay16);
    assert.ok(haikuDay17);
    assert.equal(haikuDay16.totals.inputTokens, 50);
    assert.equal(haikuDay17.totals.inputTokens, 200);
    assert.deepEqual(Object.keys(haikuDay17.models), ["claude-haiku-main"]);
    assert.equal(haikuDay17.totals.costUsd, 0.02);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("aggregateUsage：一行多模型键全量累加到 totals 并分别计 calls", () => {
  const home = makeHome();
  try {
    writeMirror(home, "2026-11-18", [
      ledgerLine(localTs("2026-11-18"), {
        models: {
          "claude-sonnet-9-9": {
            inputTokens: 100,
            outputTokens: 10,
            cacheReadTokens: 5,
            cacheWriteTokens: 2,
            webSearchRequests: 0,
          },
          "claude-haiku-main": {
            inputTokens: 200,
            outputTokens: 20,
            cacheReadTokens: 30,
            cacheWriteTokens: 3,
            webSearchRequests: 1,
          },
        },
      }),
    ]);

    const result = aggregateUsage({ day: "2026-11-18" }, { home });
    assert.equal(result.length, 1);
    const entry = result[0];
    assert.ok(entry);
    const { totals, models } = entry;
    assert.equal(totals.calls, 1);
    assert.equal(totals.inputTokens, 300);
    assert.equal(totals.outputTokens, 30);
    assert.equal(totals.cacheReadTokens, 35);
    assert.equal(totals.cacheWriteTokens, 5);
    assert.equal(totals.costUsd, 0);
    const sonnetModel = models["claude-sonnet-9-9"];
    const haikuModel = models["claude-haiku-main"];
    assert.ok(sonnetModel);
    assert.ok(haikuModel);
    assert.equal(sonnetModel.calls, 1);
    assert.equal(haikuModel.calls, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("aggregateUsage：跨天同 surface 累加并按天排序", () => {
  const home = makeHome();
  try {
    writeMirror(home, "2026-11-18", [ledgerLine(localTs("2026-11-18"))]);
    writeMirror(home, "2026-11-17", [ledgerLine(localTs("2026-11-17"))]);
    writeMirror(home, "2026-11-16", [ledgerLine(localTs("2026-11-16"))]);

    const result = aggregateUsage({ surface: "chat" }, { home });
    assert.deepEqual(result.map((entry) => entry.day), ["2026-11-16", "2026-11-17", "2026-11-18"]);
    assert.ok(result.every((entry) => entry.totals.calls === 1));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("aggregateUsage：空镜像与未知版本行返回空聚合", () => {
  const home = makeHome();
  try {
    assert.deepEqual(aggregateUsage({}, { home }), []);

    writeMirror(home, "2026-11-18", [
      ledgerLine(localTs("2026-11-18"), { v: 2 }),
      "{broken-json",
    ]);
    assert.deepEqual(aggregateUsage({}, { home }), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("aggregateUsageBuckets：每格带输入/输出/缓存、调用、错误、成本、模型与界面明细", () => {
  const home = makeHome();
  try {
    writeMirror(home, "2026-11-18", [
      ledgerLine(localTs("2026-11-18", 12), {
        surface: "code",
        isError: true,
        models: {
          "model-a": {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 30,
            cacheWriteTokens: 4,
            webSearchRequests: 2,
            cost: { usd: 0.25, basis: "list" },
          },
          "model-b": {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheWriteTokens: 1,
            webSearchRequests: 0,
          },
        },
      }),
    ]);

    const now = new Date(2026, 10, 18, 12, 10);
    const buckets = aggregateUsageBuckets("1h", { home, now });
    assert.equal(buckets.length, 336);

    const cell = buckets[0];
    assert.ok(cell);
    assert.equal(cell.value, 170);
    assert.equal(cell.detail?.inputTokens, 110);
    assert.equal(cell.detail?.outputTokens, 25);
    assert.equal(cell.detail?.cacheReadTokens, 30);
    assert.equal(cell.detail?.cacheWriteTokens, 5);
    assert.equal(cell.detail?.webSearchRequests, 2);
    assert.equal(cell.detail?.calls, 1);
    assert.equal(cell.detail?.errors, 1);
    assert.equal(cell.detail?.costUsd, 0.25);
    assert.deepEqual(Object.keys(cell.detail?.models ?? {}), ["model-a", "model-b"]);
    assert.deepEqual(cell.detail?.surfaces, { code: 1 });
    assert.equal(buckets[1]?.detail, null, "没有记录的格子明细必须为 null");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
