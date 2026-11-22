import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { loadSettings } from "../core/settings/index.ts";
import type { Settings } from "../core/settings/index.ts";
import { UsageIngestService } from "../core/usage/ingest/service.ts";
import type { SyncSummary } from "../core/usage/ingest/types.ts";

const PLATFORM = { platform: "darwin", env: {} } as const;
const NOW = "2026-01-01T12:00:00.000Z";
const TS = new Date(2026, 0, 1, 12, 0, 0).getTime();

interface Fixture {
  readonly home: string;
  readonly claudeRoot: string;
  readonly ledgerDir: string;
  readonly file: string;
  cleanup(): void;
}

function fixture(options: { root?: string; day?: string } = {}): Fixture {
  const home = mkdtempSync(join(tmpdir(), "shipcat-ingest-"));
  const claudeRoot = options.root ?? join(home, "Library", "Application Support", "Claude-3p");
  const day = options.day ?? "2026-01-01";
  const ledgerDir = join(
    claudeRoot,
    "local-agent-mode-sessions",
    "account-1",
    "workspace-1",
    "usage-ledger",
  );
  mkdirSync(ledgerDir, { recursive: true });
  return {
    home,
    claudeRoot,
    ledgerDir,
    file: join(ledgerDir, `${day}.ndjson`),
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

function ledgerLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    ts: TS,
    surface: "chat",
    origin: "turn",
    sessionId: "session-1",
    isError: false,
    models: {
      "claude-sonnet": {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 5,
        cacheWriteTokens: 1,
        webSearchRequests: 2,
      },
    },
    ...overrides,
  });
}

function settingsFor(root: string | null): Settings {
  return {
    version: 1,
    usage: {
      sources: [{ id: "claude-desktop", kind: "claude-desktop", root, enabled: true }],
    },
  };
}

function createService(
  home: string,
  settings: Settings,
  nowIso = NOW,
): UsageIngestService {
  return new UsageIngestService({
    home,
    platform: PLATFORM,
    settings,
    watch: false,
    intervalMs: 0,
    now: () => new Date(nowIso),
  });
}

interface OpenedDatabase {
  readonly db: DatabaseSync;
  scalar(sql: string): number;
  close(): void;
}

function openDb(home: string): OpenedDatabase {
  const db = new DatabaseSync(
    join(home, ".claudeharbor", "database", "claudeharbor.db"),
  );
  return {
    db,
    scalar(sql: string): number {
      const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
      return row === undefined ? 0 : Number(Object.values(row)[0]);
    },
    close: () => db.close(),
  };
}

function query<T>(home: string, fn: (db: OpenedDatabase) => T): T {
  const opened = openDb(home);
  try {
    return fn(opened);
  } finally {
    opened.close();
  }
}

test("用量入库：首次全量导入事件、映射、指标与游标", async () => {
  const fx = fixture();
  try {
    const content = `${ledgerLine({ sessionId: "s-1" })}\n${ledgerLine({
      sessionId: "s-2",
      models: {
        "claude-opus": {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 3,
          cacheWriteTokens: 4,
          webSearchRequests: 5,
        },
      },
    })}\n`;
    writeFileSync(fx.file, content);

    const service = createService(fx.home, settingsFor(null));
    const summary = await service.syncNow();
    assert.equal(summary.filesScanned, 1);
    assert.equal(summary.filesNew, 1);
    assert.equal(summary.eventsAdded, 2);
    assert.equal(summary.mappingsAdded, 2);
    assert.equal(summary.metricsWritten, 2);
    assert.equal(summary.revision, 1);
    service.dispose();

    query(fx.home, ({ scalar, db }) => {
      assert.equal(scalar("SELECT COUNT(*) FROM usage_events"), 2);
      assert.equal(scalar("SELECT COUNT(*) FROM usage_event_sources"), 2);
      assert.equal(scalar("SELECT COUNT(*) FROM usage_model_metrics"), 2);
      assert.equal(scalar("SELECT COUNT(*) FROM usage_files"), 1);
      assert.equal(scalar("SELECT revision FROM usage_files"), 1);
      assert.equal(
        scalar("SELECT byte_offset FROM usage_files"),
        Buffer.byteLength(content),
      );
      assert.equal(
        scalar("SELECT COUNT(*) FROM usage_sources WHERE id = 'claude-desktop'"),
        1,
      );
      assert.equal(scalar("SELECT COUNT(*) FROM app_meta WHERE key = 'usage_revision'"), 1);
      assert.equal(scalar("SELECT value FROM app_meta WHERE key = 'usage_revision'"), 1);

      const row = db
        .prepare("SELECT day, ts, surface, origin, session_id FROM usage_events ORDER BY id")
        .all() as Record<string, unknown>[];
      assert.equal(row[0]?.day, "2026-01-01");
      assert.equal(row[0]?.ts, TS);
      assert.equal(row[0]?.surface, "chat");
      assert.equal(row[0]?.origin, "turn");
      assert.equal(row[0]?.session_id, "s-1");
    });
  } finally {
    fx.cleanup();
  }
});

test("用量入库：追加行只导入新增事件", async () => {
  const fx = fixture();
  try {
    writeFileSync(fx.file, `${ledgerLine({ sessionId: "s-1" })}\n`);
    const service = createService(fx.home, settingsFor(null));
    const first = await service.syncNow();
    assert.equal(first.eventsAdded, 1);
    assert.equal(first.revision, 1);

    appendFileSync(fx.file, `${ledgerLine({ sessionId: "s-2" })}\n`);
    const second = await service.syncNow();
    assert.equal(second.filesAppended, 1);
    assert.equal(second.eventsAdded, 1);
    assert.equal(second.revision, 2);

    service.dispose();
    query(fx.home, ({ scalar }) => {
      assert.equal(scalar("SELECT COUNT(*) FROM usage_events"), 2);
      assert.equal(scalar("SELECT COUNT(*) FROM usage_event_sources"), 2);
    });
  } finally {
    fx.cleanup();
  }
});

test("用量入库：重复导入幂等且不推进 revision", async () => {
  const fx = fixture();
  try {
    writeFileSync(fx.file, `${ledgerLine()}\n`);
    const service = createService(fx.home, settingsFor(null));
    const first = await service.syncNow();
    assert.equal(first.revision, 1);

    const second = await service.syncNow();
    assert.equal(second.filesUnchanged, 1);
    assert.equal(second.eventsAdded, 0);
    assert.equal(second.revision, 1);

    service.dispose();
    query(fx.home, ({ scalar }) => {
      assert.equal(scalar("SELECT COUNT(*) FROM usage_events"), 1);
    });
  } finally {
    fx.cleanup();
  }
});

test("用量入库：文件重写替换旧事件并清理孤立映射", async () => {
  const fx = fixture();
  try {
    writeFileSync(fx.file, `${ledgerLine({ sessionId: "old" })}\n`);
    const service = createService(fx.home, settingsFor(null));
    await service.syncNow();

    writeFileSync(
      fx.file,
      `${ledgerLine({ sessionId: "new", surface: "code" })}\n`,
    );
    const second = await service.syncNow();
    assert.equal(second.filesRewritten, 1);
    assert.equal(second.eventsAdded, 1);
    assert.equal(second.revision, 2);

    service.dispose();
    query(fx.home, ({ scalar, db }) => {
      assert.equal(scalar("SELECT COUNT(*) FROM usage_events"), 1);
      assert.equal(scalar("SELECT COUNT(*) FROM usage_event_sources"), 1);
      assert.equal(scalar("SELECT COUNT(*) FROM usage_model_metrics"), 1);
      const row = db.prepare("SELECT session_id, surface FROM usage_events").get() as Record<
        string,
        unknown
      >;
      assert.equal(row.session_id, "new");
      assert.equal(row.surface, "code");
    });
  } finally {
    fx.cleanup();
  }
});

test("用量入库：两个来源指向同一文件只产生一条事件、两条映射", async () => {
  const fx = fixture();
  try {
    writeFileSync(fx.file, `${ledgerLine()}\n`);
    const settings: Settings = {
      version: 1,
      usage: {
        sources: [
          { id: "source-a", kind: "claude-desktop", root: fx.claudeRoot, enabled: true },
          { id: "source-b", kind: "claude-desktop", root: fx.claudeRoot, enabled: true },
        ],
      },
    };
    const service = createService(fx.home, settings);
    const summary = await service.syncNow();
    assert.equal(summary.eventsAdded, 1);
    assert.equal(summary.eventsReused, 1);
    assert.equal(summary.mappingsAdded, 2);

    service.dispose();
    query(fx.home, ({ scalar }) => {
      assert.equal(scalar("SELECT COUNT(*) FROM usage_events"), 1);
      assert.equal(scalar("SELECT COUNT(*) FROM usage_event_sources"), 2);
      assert.equal(scalar("SELECT COUNT(*) FROM usage_model_metrics"), 1);
      assert.equal(scalar("SELECT COUNT(*) FROM usage_files"), 2);
    });
  } finally {
    fx.cleanup();
  }
});

test("用量入库：未知版本入库并去重告警一次", async () => {
  const fx = fixture();
  try {
    writeFileSync(
      fx.file,
      `${ledgerLine({ v: 2, sessionId: "s-1" })}\n${ledgerLine({ sessionId: "s-2" })}\n`,
    );
    const service = createService(fx.home, settingsFor(null));
    const summary = await service.syncNow();
    assert.equal(summary.eventsAdded, 2);
    assert.deepEqual(summary.unknownVersionsSeen, { "2": 1 });
    assert.equal(
      summary.warnings.filter((warning) => warning.includes("v=2")).length,
      1,
    );

    service.dispose();
    query(fx.home, ({ scalar }) => {
      assert.equal(scalar("SELECT COUNT(*) FROM usage_events"), 2);
    });
  } finally {
    fx.cleanup();
  }
});

test("用量入库：坏行跳过、完整行继续导入且游标前进", async () => {
  const fx = fixture();
  try {
    const content = `{ not-json\n${ledgerLine()}\n`;
    writeFileSync(fx.file, content);
    const service = createService(fx.home, settingsFor(null));
    const summary = await service.syncNow();
    assert.equal(summary.eventsAdded, 1);
    assert.equal(summary.warnings.length, 1);
    assert.match(summary.warnings[0] ?? "", /第 1 行解析失败/);

    service.dispose();
    query(fx.home, ({ scalar }) => {
      assert.equal(scalar("SELECT COUNT(*) FROM usage_events"), 1);
      assert.equal(
        scalar("SELECT byte_offset FROM usage_files"),
        Buffer.byteLength(content),
      );
    });
  } finally {
    fx.cleanup();
  }
});

test("用量入库：settings 的 root 覆盖平台自动探测", async () => {
  const customRoot = join(tmpdir(), `shipcat-custom-${process.pid}-${Date.now()}`);
  const fx = fixture({ root: customRoot });
  try {
    writeFileSync(fx.file, `${ledgerLine()}\n`);
    const service = createService(fx.home, settingsFor(customRoot));
    const summary = await service.syncNow();
    assert.equal(summary.eventsAdded, 1);

    service.dispose();
    query(fx.home, ({ db }) => {
      const row = db
        .prepare("SELECT root FROM usage_sources WHERE id = 'claude-desktop'")
        .get() as Record<string, unknown>;
      assert.equal(
        row.root,
        join(customRoot, "local-agent-mode-sessions"),
      );
    });
  } finally {
    fx.cleanup();
    rmSync(customRoot, { recursive: true, force: true });
  }
});

test("用量入库：事务提交后监听器收到 revision", async () => {
  const fx = fixture();
  try {
    writeFileSync(fx.file, `${ledgerLine()}\n`);
    const service = createService(fx.home, settingsFor(null));
    const revisions: number[] = [];
    service.onChanged((revision) => revisions.push(revision));

    const summary = await service.syncNow();
    assert.deepEqual(revisions, [summary.revision]);
    assert.equal(summary.revision, 1);

    await service.syncNow();
    assert.deepEqual(revisions, [1], "unchanged 不通知");

    service.dispose();
  } finally {
    fx.cleanup();
  }
});

test("settings：缺失时写默认，损坏时备份并重建，相对 root 归一为 null", () => {
  const home = mkdtempSync(join(tmpdir(), "shipcat-settings-"));
  try {
    const first = loadSettings(home, PLATFORM);
    assert.equal(first.usage.sources.length, 1);
    assert.equal(first.usage.sources[0]?.id, "claude-desktop");
    assert.equal(first.usage.sources[0]?.root, null);
    assert.ok(existsSync(join(home, ".claudeharbor", "settings.json")));

    const file = join(home, ".claudeharbor", "settings.json");
    writeFileSync(file, "{ broken", "utf8");
    const second = loadSettings(home, PLATFORM);
    assert.equal(second.usage.sources.length, 1);
    assert.ok(
      readdirSync(join(home, ".claudeharbor")).some((name) =>
        name.startsWith("settings.json.bak-"),
      ),
    );

    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        usage: {
          sources: [
            { id: "custom", kind: "claude-desktop", root: "relative/path", enabled: false },
          ],
        },
      }),
    );
    const third = loadSettings(home, PLATFORM);
    assert.equal(third.usage.sources[0]?.root, null);
    assert.equal(third.usage.sources[0]?.enabled, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
