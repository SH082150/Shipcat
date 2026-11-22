import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDatabase } from "../core/persistence/index.ts";
import { getUsageView } from "../core/queries/usage.ts";
import type { UsageViewQuery } from "../core/queries/usage.ts";
import { UsageIngestService } from "../core/usage/ingest/service.ts";
import type { UsageViewDto } from "../core/queries/usage.ts";

const PLATFORM = { platform: "darwin", env: {} } as const;
const NOW = new Date(2026, 0, 15, 12, 0, 0);
const NOW_ISO = NOW.toISOString();

interface Fixture {
  readonly home: string;
  readonly file: string;
  cleanup(): void;
}

function fixture(): Fixture {
  const home = mkdtempSync(join(tmpdir(), "shipcat-queries-"));
  const ledgerDir = join(
    home,
    "Library",
    "Application Support",
    "Claude-3p",
    "local-agent-mode-sessions",
    "account-1",
    "workspace-1",
    "usage-ledger",
  );
  mkdirSync(ledgerDir, { recursive: true });
  return {
    home,
    file: join(ledgerDir, "2026-01-15.ndjson"),
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

function line(
  ts: Date,
  surface: string,
  models: Record<string, Record<string, number>>,
): string {
  return JSON.stringify({
    v: 1,
    ts: ts.getTime(),
    surface,
    origin: "turn",
    sessionId: `s-${ts.getTime()}-${surface}`,
    isError: false,
    models,
  });
}

function settings(): {
  version: 1;
  usage: { sources: { id: string; kind: string; root: null; enabled: boolean }[] };
} {
  return {
    version: 1,
    usage: {
      sources: [{ id: "claude-desktop", kind: "claude-desktop", root: null, enabled: true }],
    },
  };
}

function query(heatmapRange: UsageViewQuery["heatmapRange"], dailyDays = 30): UsageViewQuery {
  return { heatmapRange, dailyDays: dailyDays as UsageViewQuery["dailyDays"] };
}

async function seed(): Promise<{ fixture: Fixture; service: UsageIngestService }> {
  const fx = fixture();
  writeFileSync(
    fx.file,
    [
      line(new Date(2026, 0, 15, 12, 5), "chat", {
        "model-a": {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 5,
          cacheWriteTokens: 1,
          webSearchRequests: 2,
        },
        "model-b": {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 3,
          cacheWriteTokens: 4,
          webSearchRequests: 5,
        },
      }),
      line(new Date(2026, 0, 15, 11, 35), "code", {
        "model-a": { inputTokens: 5, outputTokens: 5 },
      }),
      line(new Date(2026, 0, 15, 11, 0), "cowork", {
        "model-a": { inputTokens: 10, outputTokens: 10 },
      }),
      "",
    ].join("\n"),
  );
  const service = new UsageIngestService({
    home: fx.home,
    platform: PLATFORM,
    settings: settings(),
    watch: false,
    intervalMs: 0,
    now: () => NOW,
  });
  await service.syncNow();
  return { fixture: fx, service };
}

function read(service: UsageIngestService, q: UsageViewQuery): UsageViewDto {
  return service.withDatabase((db) => getUsageView(db, q, NOW));
}

test("getUsageView：30 分钟热力图分桶、level 与 calls 计数", async () => {
  const { fixture: fx, service } = await seed();
  try {
    const view = read(service, query("30min"));
    assert.equal(view.heatmap.length, 336);
    assert.equal(view.revision, 1);
    assert.equal(view.lastSyncedAt, NOW_ISO);

    const newest = view.heatmap[0];
    assert.ok(newest);
    assert.equal(newest.start, new Date(2026, 0, 15, 12, 0).toISOString());
    assert.equal(newest.end, new Date(2026, 0, 15, 12, 30).toISOString());
    assert.equal(newest.value, 46);
    assert.equal(newest.level, 4);
    assert.deepEqual(newest.detail, {
      inputTokens: 11,
      outputTokens: 22,
      cacheReadTokens: 8,
      cacheWriteTokens: 5,
      calls: 1,
      webSearchRequests: 7,
    });

    const previous = view.heatmap[1];
    assert.ok(previous);
    assert.equal(previous.value, 10);
    assert.equal(previous.level, 1);
    assert.equal(previous.detail.calls, 1);

    const older = view.heatmap[2];
    assert.ok(older);
    assert.equal(older.value, 20);
    assert.equal(older.level, 2);

    const empty = view.heatmap[3];
    assert.ok(empty);
    assert.equal(empty.value, 0);
    assert.equal(empty.level, 0);
    assert.equal(empty.detail.calls, 0);
  } finally {
    service.dispose();
    fx.cleanup();
  }
});

test("getUsageView：1 小时与 1 天分桶使用各自的桶宽", async () => {
  const { fixture: fx, service } = await seed();
  try {
    const hourly = read(service, query("1h"));
    assert.equal(hourly.heatmap.length, 336);
    assert.equal(hourly.heatmap[0]?.value, 46);
    assert.equal(hourly.heatmap[1]?.value, 30);
    assert.equal(hourly.heatmap[1]?.level, 3);

    const daily = read(service, query("1d"));
    assert.equal(daily.heatmap.length, 336);
    assert.equal(daily.heatmap[0]?.value, 76);
    assert.equal(daily.heatmap[0]?.detail.calls, 3);
    assert.equal(daily.heatmap[1]?.value, 0);
    assert.equal(daily.heatmap[0]?.start, new Date(2026, 0, 15).toISOString());
  } finally {
    service.dispose();
    fx.cleanup();
  }
});

test("getUsageView：daily 按 surface 聚合且补零到指定天数", async () => {
  const { fixture: fx, service } = await seed();
  try {
    const thirty = read(service, query("30min", 30));
    assert.equal(thirty.daily.length, 30);
    const today = thirty.daily[thirty.daily.length - 1];
    assert.deepEqual(today, { day: "2026-01-15", chat: 33, cowork: 20, code: 10 });

    const seven = read(service, query("30min", 7));
    assert.equal(seven.daily.length, 7);
    assert.equal(seven.daily[seven.daily.length - 1]?.day, "2026-01-15");
    assert.equal(seven.daily[0]?.day, "2026-01-09");

    const ninety = read(service, query("30min", 90));
    assert.equal(ninety.daily.length, 90);
  } finally {
    service.dispose();
    fx.cleanup();
  }
});

test("getUsageView：空库返回 336 个空格、全零 daily 与 null 同步时间", () => {
  const home = mkdtempSync(join(tmpdir(), "shipcat-queries-empty-"));
  try {
    const db = openDatabase({ home, platform: PLATFORM });
    try {
      const view = getUsageView(db, query("1h"), NOW);
      assert.equal(view.heatmap.length, 336);
      assert.ok(view.heatmap.every((bucket) => bucket.value === 0 && bucket.level === 0));
      assert.ok(view.heatmap.every((bucket) => bucket.detail.calls === 0));
      assert.equal(view.daily.length, 30);
      assert.ok(view.daily.every((point) => point.chat === 0 && point.cowork === 0 && point.code === 0));
      assert.equal(view.lastSyncedAt, null);
      assert.equal(view.revision, 0);
      assert.deepEqual(view.warnings, []);
    } finally {
      db.close();
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("getUsageView：非法查询回落 30min / 30 天", async () => {
  const { fixture: fx, service } = await seed();
  try {
    const view = service.withDatabase((db) =>
      getUsageView(db, { heatmapRange: "bad", dailyDays: 1 } as unknown as UsageViewQuery, NOW),
    );
    assert.equal(view.daily.length, 30);
    assert.equal(view.heatmap[0]?.start, new Date(2026, 0, 15, 12, 0).toISOString());
  } finally {
    service.dispose();
    fx.cleanup();
  }
});
