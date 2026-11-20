import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { syncLedger } from "../core/usage/index.ts";
import { officialLedgerRoot } from "../core/usage/paths/index.ts";

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "claudeharbor-usage-sync-"));
}

/**
 * 在假官方账本根下写一天的账本文件，返回其绝对路径。
 * 根由 officialLedgerRoot(home) 按平台推导（macOS 为 Application Support，
 * Windows 为 <home>/AppData/Local），目录层级 <根>/<账号>/00000000/
 * usage-ledger/<day>.ndjson 与官方保持一致。
 */
function writeOfficialLedger(home: string, account: string, day: string, content: string): string {
  const path = join(
    officialLedgerRoot(home),
    account,
    "00000000",
    "usage-ledger",
    `${day}.ndjson`,
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

/** 造一行官方账本记录（字段名与官方 1:1）。 */
function ledgerLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    ts: new Date(2026, 10, 18, 12, 0, 0).getTime(),
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
      },
    },
    ...overrides,
  });
}

function mirrorPath(home: string, day: string): string {
  return join(home, ".claudeharbor", "usage", "ledger", `${day}.ndjson`);
}

function metaPath(home: string): string {
  return join(home, ".claudeharbor", "usage", "_meta.json");
}

function readMeta(home: string): {
  schemaVersion: number;
  lastSyncAt: string;
  files: Record<
    string,
    {
      byteOffset: number;
      size: number;
      rewriteCount: number;
      source: string;
      tailHash?: string;
    }
  >;
  ledgerVersionsSeen: Record<string, number>;
  warnings: string[];
} {
  return JSON.parse(readFileSync(metaPath(home), "utf8"));
}

const NOW = new Date("2026-11-18T10:00:00.000Z");

test("syncLedger：首次同步整文件镜像并建立游标", () => {
  const home = makeHome();
  try {
    const lineA = ledgerLine();
    const lineB = ledgerLine({ surface: "code" });
    writeOfficialLedger(home, "a1b2c3d4", "2026-11-17", `${lineA}\n`);
    writeOfficialLedger(home, "a1b2c3d4", "2026-11-18", `${lineA}\n${lineB}\n`);

    const result = syncLedger({ home, now: NOW });

    assert.equal(result.filesScanned, 2);
    assert.equal(result.filesNew, 2);
    assert.equal(result.filesAppended, 0);
    assert.equal(result.filesRewritten, 0);
    assert.equal(result.filesSkipped, 0);
    assert.equal(result.linesAdded, 3);
    assert.deepEqual(result.warnings, []);
    assert.equal(readFileSync(mirrorPath(home, "2026-11-17"), "utf8"), `${lineA}\n`);
    assert.equal(readFileSync(mirrorPath(home, "2026-11-18"), "utf8"), `${lineA}\n${lineB}\n`);

    const cursor = readMeta(home).files["2026-11-18.ndjson"];
    assert.ok(cursor);
    assert.equal(cursor.byteOffset, Buffer.byteLength(`${lineA}\n${lineB}\n`, "utf8"));
    assert.equal(cursor.size, Buffer.byteLength(`${lineA}\n${lineB}\n`, "utf8"));
    assert.equal(cursor.rewriteCount, 0);
    assert.equal(cursor.source, "a1b2c3d4/00000000/usage-ledger/2026-11-18.ndjson");
    assert.match(cursor.tailHash ?? "", /^sha256:[0-9a-f]{64}$/);
    assert.equal(readMeta(home).ledgerVersionsSeen["1"], 3);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("syncLedger：官方文件追加后二次同步只增加新行且镜像一致", () => {
  const home = makeHome();
  try {
    const first = ledgerLine({ surface: "chat" });
    const source = writeOfficialLedger(home, "a1b2c3d4", "2026-11-18", `${first}\n`);
    const initial = syncLedger({ home, now: NOW });
    assert.equal(initial.linesAdded, 1);

    const secondLine = ledgerLine({ surface: "cowork" });
    writeFileSync(source, `${first}\n${secondLine}\n`);
    const second = syncLedger({ home, now: NOW });

    assert.equal(second.filesAppended, 1);
    assert.equal(second.filesNew, 0);
    assert.equal(second.filesRewritten, 0);
    assert.equal(
      readFileSync(mirrorPath(home, "2026-11-18"), "utf8"),
      readFileSync(source, "utf8"),
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("syncLedger：尾部半行不复制，补全换行后下一轮补上", () => {
  const home = makeHome();
  try {
    const first = ledgerLine();
    const partial = ledgerLine({ surface: "code" }).slice(0, 20);
    const source = writeOfficialLedger(home, "a1b2c3d4", "2026-11-18", `${first}\n${partial}`);
    const firstSync = syncLedger({ home, now: NOW });

    assert.equal(firstSync.linesAdded, 1);
    assert.equal(readFileSync(mirrorPath(home, "2026-11-18"), "utf8"), `${first}\n`);

    // 补全半行（追加了完整记录 + \n）。
    const rest = ledgerLine({ surface: "code" }).slice(20);
    writeFileSync(source, `${first}\n${partial}${rest}\n`);
    const secondSync = syncLedger({ home, now: NOW });

    assert.equal(secondSync.linesAdded, 1);
    assert.equal(
      readFileSync(mirrorPath(home, "2026-11-18"), "utf8"),
      `${first}\n${ledgerLine({ surface: "code" })}\n`,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("syncLedger：篡改官方文件中间内容触发整文件重写", () => {
  const home = makeHome();
  try {
    const original = ledgerLine({ origin: "turn" });
    const source = writeOfficialLedger(home, "a1b2c3d4", "2026-11-18", `${original}\n`);
    syncLedger({ home, now: NOW });

    // 同长度改写中间内容：size 不小于游标，靠尾部指纹发现非追加改写。
    const tampered = ledgerLine({ origin: "xxxx" });
    assert.equal(tampered.length, original.length);
    writeFileSync(source, `${tampered}\n`);

    const result = syncLedger({ home, now: NOW });
    assert.equal(result.filesRewritten, 1);
    const rewritten = readMeta(home).files["2026-11-18.ndjson"];
    assert.ok(rewritten);
    assert.equal(rewritten.rewriteCount, 1);
    assert.equal(readFileSync(mirrorPath(home, "2026-11-18"), "utf8"), `${tampered}\n`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("syncLedger：官方文件截断（size 小于游标）触发整文件重写", () => {
  const home = makeHome();
  try {
    const line1 = ledgerLine();
    const line2 = ledgerLine({ surface: "code" });
    const source = writeOfficialLedger(home, "a1b2c3d4", "2026-11-18", `${line1}\n${line2}\n`);
    syncLedger({ home, now: NOW });

    // 官方文件被外部截断成一行。
    writeFileSync(source, `${line1}\n`);
    const result = syncLedger({ home, now: NOW });

    assert.equal(result.filesRewritten, 1);
    assert.equal(readFileSync(mirrorPath(home, "2026-11-18"), "utf8"), `${line1}\n`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("syncLedger：同一 day 出现在多个账号来源时告警并跳过", () => {
  const home = makeHome();
  try {
    writeOfficialLedger(home, "a1b2c3d4", "2026-11-18", `${ledgerLine()}\n`);
    writeOfficialLedger(home, "a0b1c2d3", "2026-11-18", `${ledgerLine({ surface: "code" })}\n`);
    writeOfficialLedger(home, "a1b2c3d4", "2026-11-17", `${ledgerLine()}\n`);

    const result = syncLedger({ home, now: NOW });

    assert.equal(result.filesScanned, 3);
    assert.equal(result.filesNew, 1);
    assert.equal(result.filesSkipped, 2);
    assert.ok(result.warnings.some((w) => w.includes("2026-11-18") && w.includes("已跳过")));
    assert.equal(existsSync(mirrorPath(home, "2026-11-18")), false);
    assert.equal(existsSync(mirrorPath(home, "2026-11-17")), true);
    assert.equal(readMeta(home).files["2026-11-18.ndjson"], undefined);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("syncLedger：未知 v 的行照样镜像、计入告警且不重复提示", () => {
  const home = makeHome();
  try {
    const known = ledgerLine();
    const future = ledgerLine({ v: 2, surface: "code" });
    writeOfficialLedger(home, "a1b2c3d4", "2026-11-18", `${known}\n${future}\n`);

    const first = syncLedger({ home, now: NOW });
    assert.equal(first.unknownVersionsSeen["2"], 1);
    assert.equal(readMeta(home).ledgerVersionsSeen["2"], 1);
    const versionWarnings = first.warnings.filter((w) => w.includes("v=2"));
    assert.equal(versionWarnings.length, 1);
    assert.equal(
      readFileSync(mirrorPath(home, "2026-11-18"), "utf8"),
      `${known}\n${future}\n`,
    );

    const second = syncLedger({ home, now: NOW });
    assert.equal(second.warnings.filter((w) => w.includes("v=2")).length, 0);
    assert.deepEqual(second.unknownVersionsSeen, {});
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("syncLedger：坏行只告警不中断同步", () => {
  const home = makeHome();
  try {
    const good = ledgerLine();
    writeOfficialLedger(home, "a1b2c3d4", "2026-11-18", `${good}\n{broken-json\n`);

    const result = syncLedger({ home, now: NOW });

    assert.equal(result.filesNew, 1);
    assert.equal(result.filesSkipped, 0);
    assert.equal(result.linesAdded, 2);
    assert.ok(result.warnings.some((w) => w.includes("解析失败")));
    assert.equal(readMeta(home).ledgerVersionsSeen["1"], 1);
    assert.equal(
      readFileSync(mirrorPath(home, "2026-11-18"), "utf8"),
      `${good}\n{broken-json\n`,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("syncLedger：_meta.json 原子写入且结构完整", () => {
  const home = makeHome();
  try {
    writeOfficialLedger(home, "a1b2c3d4", "2026-11-18", `${ledgerLine()}\n`);
    syncLedger({ home, now: NOW });

    const meta = JSON.parse(readFileSync(metaPath(home), "utf8"));
    assert.equal(meta.schemaVersion, 1);
    assert.equal(meta.lastSyncAt, "2026-11-18T10:00:00.000Z");
    assert.match(meta.sourceRoot, /Claude-3p.local-agent-mode-sessions$/);
    assert.equal(typeof meta.files["2026-11-18.ndjson"].mtimeMs, "number");
    assert.deepEqual(meta.warnings, []);
    assert.equal(existsSync(join(home, ".claudeharbor", "usage", "ledger", ".2026-11-18.ndjson.tmp")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
