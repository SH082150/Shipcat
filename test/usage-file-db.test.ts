/**
 * 自建文件用量库：时区桶、Layer 1 增量/重建、tpd、Layer 2 视图、时钟。
 *
 * 全部使用临时目录与注入时间，不读真实 Claude 数据。
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { UsageClock } from "../core/usage/clock.ts";
import { UsageService } from "../core/usage/service.ts";
import {
  addLocalDays,
  formatLocalDay,
  formatLocalMinute,
  localBucketStart,
  localDayStart,
  windowStarts,
} from "../core/usage/time.ts";
import { readCellAt } from "../core/usage/layer1/query.ts";
import { levelDir } from "../core/usage/layer1/paths.ts";
import { readLayer2 } from "../core/usage/layer2/query.ts";

const TZ = "Asia/Shanghai";

interface Fixture {
  readonly home: string;
  readonly sessions: string;
  readonly usageRoot: string;
  readonly ledger: string;
  cleanup(): void;
}

function fixture(): Fixture {
  const home = mkdtempSync(join(tmpdir(), "shipcat-usage-db-"));
  const sessions = join(home, "sessions");
  const ledger = join(sessions, "54cd5b41", "00000000", "usage-ledger");
  mkdirSync(ledger, { recursive: true });
  const usageRoot = join(home, "usage");
  mkdirSync(usageRoot, { recursive: true });
  // 固定时区，避免测试机时区影响。
  writeFileSync(
    join(usageRoot, "config.json"),
    JSON.stringify({ timezone: TZ, syncIntervalMinutes: 5 }),
  );
  return {
    home,
    sessions,
    usageRoot,
    ledger,
    cleanup() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}

function line(ts: number, surface: string, tokens: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    ts,
    surface,
    origin: "turn",
    sessionId: "s",
    isError: false,
    models: {
      m: {
        inputTokens: tokens,
        outputTokens: Math.round(tokens / 2),
        cacheReadTokens: tokens * 2,
        cacheWriteTokens: 0,
        webSearchRequests: 1,
        cost: { usd: 0.001, basis: "list" },
      },
    },
    ...extra,
  });
}

function appendLedger(fx: Fixture, day: string, lines: readonly string[]): void {
  mkdirSync(fx.ledger, { recursive: true });
  writeFileSync(join(fx.ledger, `${day}.ndjson`), `${lines.join("\n")}\n`);
}

function makeService(fx: Fixture, now: () => number): UsageService {
  return new UsageService({
    usageRoot: fx.usageRoot,
    sourceRoot: () => ({ root: fx.sessions }),
    now,
    clock: false,
  });
}

// 2026-01-15 12:00 Asia/Shanghai = 04:00 UTC
const NOON = Date.UTC(2026, 0, 15, 4, 0, 0);

test("time：本地桶与本地日按注入时区计算", () => {
  assert.equal(formatLocalMinute(NOON, TZ), "2026-01-15 12:00");
  assert.equal(formatLocalDay(NOON, TZ), "2026-01-15");

  const bucket30 = localBucketStart(NOON + 12 * 60_000, "30m", TZ);
  assert.equal(formatLocalMinute(bucket30, TZ), "2026-01-15 12:00");

  const bucket1h = localBucketStart(NOON + 45 * 60_000, "1h", TZ);
  assert.equal(formatLocalMinute(bucket1h, TZ), "2026-01-15 12:00");

  const day = localDayStart(NOON, TZ);
  assert.equal(formatLocalDay(day, TZ), "2026-01-15");
  assert.equal(formatLocalDay(addLocalDays(day, 1, TZ), TZ), "2026-01-16");
});

test("time：DST 日按日历日推进，不固定 24 小时", () => {
  const tz = "America/New_York";
  // 2026-03-08 美国进入夏令时：本地日只有 23 小时。
  const start = localDayStart(Date.UTC(2026, 2, 8, 12, 0, 0), tz);
  const next = addLocalDays(start, 1, tz);
  assert.equal(formatLocalDay(next, tz), "2026-03-09");
  assert.equal(next - start, 23 * 60 * 60_000);
});

test("Layer 1：重建、增量与去重", async () => {
  const fx = fixture();
  try {
    appendLedger(fx, "2026-01-15", [line(NOON, "code", 10, { tools: { Read: 2, Bash: 1 } })]);
    const service = makeService(fx, () => NOON + 5 * 60_000);
    const first = await service.start();
    assert.equal(first.skipped, false);
    assert.deepEqual(first.rebuiltLevels, ["30m", "1h", "1d"]);

    const bucket = localBucketStart(NOON, "30m", TZ);
    const cell = readCellAt(fx.usageRoot, "30m", bucket);
    assert.ok(cell);
    assert.equal(cell.inputTokens, 10);
    assert.equal(cell.outputTokens, 5);
    assert.equal(cell.cacheReadTokens, 20);
    assert.equal(cell.toolCalls, 3);
    assert.equal(Math.round(cell.cost * 1_000_000), 1000);

    // 追加一条新事件 → 增量累加。
    appendLedger(fx, "2026-01-15", [
      line(NOON, "code", 10, { tools: { Read: 2, Bash: 1 } }),
      line(NOON + 10 * 60_000, "code", 4),
    ]);
    const second = await service.syncNow("manual");
    assert.equal(second.eventsProcessed > 0, true);
    const updated = readCellAt(fx.usageRoot, "30m", bucket);
    assert.ok(updated);
    assert.equal(updated.inputTokens, 14);

    // 同一份账本再同步一次：不重复计数。
    await service.syncNow("manual");
    const again = readCellAt(fx.usageRoot, "30m", bucket);
    assert.ok(again);
    assert.equal(again.inputTokens, 14);

    service.dispose();
  } finally {
    fx.cleanup();
  }
});

test("Layer 1：空闲滚窗口，旧桶删除、新桶补零、meta 不倒退", async () => {
  const fx = fixture();
  try {
    appendLedger(fx, "2026-01-15", [line(NOON, "code", 10)]);
    let now = NOON;
    const service = makeService(fx, () => now);
    await service.start();

    const dir = levelDir(fx.usageRoot, "30m");
    const metaBefore = JSON.parse(readFileSync(join(dir, "_meta_.json"), "utf8")) as {
      ts: number;
    };

    now = NOON + 8 * 24 * 60 * 60_000; // 8 天后
    await service.syncNow("manual");

    const starts = windowStarts("30m", now, TZ);
    const metaAfter = JSON.parse(readFileSync(join(dir, "_meta_.json"), "utf8")) as { ts: number };
    assert.equal(metaAfter.ts, metaBefore.ts, "空闲滚动不得推进 meta");

    const newest = starts[0] ?? 0;
    const zero = readCellAt(fx.usageRoot, "30m", newest);
    assert.ok(zero);
    assert.equal(zero.inputTokens, 0);

    service.dispose();
  } finally {
    fx.cleanup();
  }
});

test("Layer 1：tpd 按 surface 汇总输入+输出", async () => {
  const fx = fixture();
  try {
    appendLedger(fx, "2026-01-15", [
      line(NOON, "code", 10),
      line(NOON + 60_000, "cowork", 20),
      line(NOON + 120_000, "chat", 4),
    ]);
    const service = makeService(fx, () => NOON + 5 * 60_000);
    await service.start();

    const view = service.getView({ heatmapRange: "1d", dailyDays: 7 });
    const today = view.daily[view.daily.length - 1];
    assert.ok(today);
    assert.equal(today.day, "2026-01-15");
    assert.equal(today.code, 15);
    assert.equal(today.cowork, 30);
    assert.equal(today.chat, 6);
    assert.equal(view.daily.length, 7);

    service.dispose();
  } finally {
    fx.cleanup();
  }
});

test("Layer 2：cells.json 336 槽位 + 视图指针", async () => {
  const fx = fixture();
  try {
    appendLedger(fx, "2026-01-15", [line(NOON, "code", 10)]);
    const now = NOON + 5 * 60_000;
    const service = makeService(fx, () => now);
    await service.start();

    const snapshot = readLayer2(fx.usageRoot, "30m");
    assert.ok(snapshot);
    assert.equal(snapshot.ts.length, 336);
    assert.equal(snapshot.display.length, 336);
    assert.equal(snapshot.level.length, 336);
    assert.equal(snapshot.ts[0], localBucketStart(now, "30m", TZ));
    assert.match(snapshot.lastSyncDisplay, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const view = service.getView({ heatmapRange: "30min", dailyDays: 30 });
    assert.equal(view.heatmap.length, 336);
    assert.equal(view.revision, 1);
    assert.ok(view.lastSyncedAt !== null);
    const withData = view.heatmap.find((bucket) => bucket.detail.inputTokens === 10);
    assert.ok(withData);
    assert.equal(withData.detail.calls, 0);
    assert.equal(withData.level >= 1, true);

    service.dispose();
  } finally {
    fx.cleanup();
  }
});

test("Layer 1：_syncing_ 残留触发整库重建", async () => {
  const fx = fixture();
  try {
    appendLedger(fx, "2026-01-15", [line(NOON, "code", 10)]);
    const service = makeService(fx, () => NOON + 5 * 60_000);
    await service.start();
    service.dispose();

    writeFileSync(join(levelDir(fx.usageRoot, "30m"), "_syncing_"), "{}");
    const again = makeService(fx, () => NOON + 5 * 60_000);
    const summary = await again.start();
    assert.deepEqual(summary.rebuiltLevels, ["30m"]);
    const cell = readCellAt(fx.usageRoot, "30m", localBucketStart(NOON, "30m", TZ));
    assert.ok(cell);
    assert.equal(cell.inputTokens, 10);
    again.dispose();
  } finally {
    fx.cleanup();
  }
});

test("Clock：只在跨过对齐边界时触发一次，休眠后也只触发一次", () => {
  let now = Date.UTC(2026, 0, 15, 4, 2, 0); // 12:02
  let calls = 0;
  const clock = new UsageClock({
    intervalMinutes: 5,
    onBoundary: () => {
      calls += 1;
    },
    now: () => now,
  });
  clock.start();
  clock.tick();
  assert.equal(calls, 0);

  now += 3 * 60_000; // 12:05
  clock.tick();
  assert.equal(calls, 1);
  clock.tick();
  assert.equal(calls, 1);

  now += 30 * 60_000; // 12:35，模拟休眠跳过多个边界
  clock.tick();
  assert.equal(calls, 2);
  clock.stop();
});
