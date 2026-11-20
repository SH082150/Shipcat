/**
 * 官方 usage-ledger 账本镜像同步（全量照搬、按天平铺、字节游标增量 +
 * 改写检测）。
 *
 * 镜像只追加/整拷字节，不修改账本内容；逐行 JSON.parse 仅用于
 * 版本统计（v 字段）与坏行告警，不阻断同步。规则：
 * - 无游标 → 整文件复制（只到最后一个完整行，尾部半行不拷）；
 * - size < byteOffset 或尾部指纹不匹配 → 判定非追加改写，截断镜像整文件重拷；
 * - 同一 day 出现在多个来源 → 告警并跳过，不覆盖已镜像文件；
 * - 含未知 v 的行照样镜像，按版本号去重告警一次；
 * - _meta.json 原子写（tmp + rename，复用 archive/fs 原语）。
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { join } from "node:path";

import { applyFileMode, atomicWriteJson, readJson, SECRET_MODE } from "../../archive/fs/index.ts";
import { resolveHome } from "../../platform/index.ts";
import { ledgerDir, listOfficialLedgerFiles, metaFile, officialLedgerRoot } from "../paths/index.ts";
import { KNOWN_LEDGER_VERSION } from "../types/index.ts";
import type { LedgerFileCursor, LedgerRecord, SyncResult, UsageMeta } from "../types/index.ts";

/** 改写检测窗口：游标边界前多少字节参与 sha256。 */
const TAIL_BYTES = 4096;

export interface SyncLedgerOptions {
  /** 缺省 resolveHome()（测试注入临时目录）。 */
  readonly home?: string;
  /** 注入"现在"，便于测试断言 lastSyncedAt。 */
  readonly now?: Date;
}

type FileAction = "new" | "appended" | "rewritten" | "unchanged";

interface FileSyncOutcome {
  readonly action: FileAction;
  readonly linesAdded: number;
  readonly versionsSeen: Record<string, number>;
  /** 镜像中 JSON.parse 失败的 1 起始行号（已镜像，不计版本统计）。 */
  readonly badLines: number[];
  readonly cursor: LedgerFileCursor;
}

/** 同步官方账本到 ~/.claudeharbor/usage/ledger，返回本轮同步摘要。 */
export function syncLedger(options: SyncLedgerOptions = {}): SyncResult {
  const home = options.home ?? resolveHome();
  const now = options.now ?? new Date();
  const sourceRoot = officialLedgerRoot(home);
  const mirrorRoot = ledgerDir(home);
  mkdirSync(mirrorRoot, { recursive: true, mode: 0o700 });

  const meta = readUsageMeta(metaFile(home), sourceRoot);
  const warnings: string[] = [];
  const unknownVersionsSeen: Record<string, number> = {};
  const versionsThisRound: Record<string, number> = {};
  const files = { ...meta.files };

  let filesNew = 0;
  let filesAppended = 0;
  let filesRewritten = 0;
  let filesSkipped = 0;
  let linesAdded = 0;

  const sources = listOfficialLedgerFiles(sourceRoot);
  const conflictedDays = findConflictedDays(sources);

  for (const source of sources) {
    if (conflictedDays.has(source.day)) {
      filesSkipped += 1;
      continue;
    }
    const cursorKey = `${source.day}.ndjson`;
    try {
      const outcome = syncOneFile(source, files[cursorKey], mirrorRoot, now);
      files[cursorKey] = outcome.cursor;
      if (outcome.action === "new") filesNew += 1;
      else if (outcome.action === "appended") filesAppended += 1;
      else if (outcome.action === "rewritten") filesRewritten += 1;
      linesAdded += outcome.linesAdded;
      for (const [version, count] of Object.entries(outcome.versionsSeen)) {
        versionsThisRound[version] = (versionsThisRound[version] ?? 0) + count;
      }
      for (const badLine of outcome.badLines) {
        warnings.push(`文件 ${source.sourceRel} 第 ${badLine} 行解析失败，已镜像但未计入版本统计`);
      }
    } catch (err) {
      filesSkipped += 1;
      warnings.push(
        `文件 ${source.sourceRel} 同步失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  for (const conflictedDay of [...conflictedDays].sort()) {
    warnings.push(`day ${conflictedDay} 存在多个来源，已跳过`);
  }

  const ledgerVersionsSeen = { ...meta.ledgerVersionsSeen };
  for (const [version, count] of Object.entries(versionsThisRound)) {
    ledgerVersionsSeen[version] = (ledgerVersionsSeen[version] ?? 0) + count;
    if (Number(version) !== KNOWN_LEDGER_VERSION) {
      unknownVersionsSeen[version] = count;
      warnings.push(
        `发现未知账本版本 v=${version}（${count} 行已按原样镜像，聚合查询将忽略）`,
      );
    }
  }

  const nextMeta: UsageMeta = {
    schemaVersion: 1,
    lastSyncAt: now.toISOString(),
    sourceRoot,
    files,
    ledgerVersionsSeen,
    warnings,
  };
  atomicWriteJson(metaFile(home), nextMeta, SECRET_MODE);

  return {
    filesScanned: sources.length,
    filesNew,
    filesAppended,
    filesRewritten,
    filesSkipped,
    linesAdded,
    warnings,
    unknownVersionsSeen,
    lastSyncAt: now.toISOString(),
  };
}

/** 同一 day 出现在多个不同 sourceRel 即冲突：不猜归属，整 day 跳过。 */
function findConflictedDays(sources: ReturnType<typeof listOfficialLedgerFiles>): Set<string> {
  const byDay = new Map<string, Set<string>>();
  for (const source of sources) {
    const set = byDay.get(source.day) ?? new Set<string>();
    set.add(source.sourceRel);
    byDay.set(source.day, set);
  }
  const conflicted = new Set<string>();
  for (const [day, set] of byDay) {
    if (set.size > 1) conflicted.add(day);
  }
  return conflicted;
}

/** 同步单个官方文件：返回镜像写入结果与新游标。 */
function syncOneFile(
  source: { day: string; absPath: string; sourceRel: string },
  previous: LedgerFileCursor | undefined,
  mirrorRoot: string,
  now: Date,
): FileSyncOutcome {
  const stat = statSync(source.absPath);
  const mirrorPath = join(mirrorRoot, `${source.day}.ndjson`);

  if (previous !== undefined) {
    if (stat.size < previous.byteOffset) {
      return rewriteFile(source, previous, mirrorPath, stat, now);
    }
    if (previous.tailHash === undefined) {
      // 旧 meta 无指纹可校验，按改写处理，重建可信游标。
      return rewriteFile(source, previous, mirrorPath, stat, now);
    }
    if (hashTail(source.absPath, previous.byteOffset) !== previous.tailHash) {
      return rewriteFile(source, previous, mirrorPath, stat, now);
    }
    return appendNewBytes(source, previous, mirrorPath, stat, now);
  }

  const content = readFileSync(source.absPath, "utf8");
  const complete = completeLinesOf(content);
  const scanned = scanVersions(complete);
  writeFileSync(mirrorPath, complete, { encoding: "utf8", mode: 0o600 });
  applyFileMode(mirrorPath, 0o600);
  const byteOffset = Buffer.byteLength(complete, "utf8");
  return {
    action: "new",
    linesAdded: lineCountOf(complete),
    versionsSeen: scanned.seen,
    badLines: scanned.badLines,
    cursor: {
      byteOffset,
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs),
      lastSyncedAt: now.toISOString(),
      rewriteCount: 0,
      source: source.sourceRel,
      tailHash: hashTail(source.absPath, byteOffset),
    },
  };
}

/** 判定改写：截断镜像、整文件重拷（同样只到最后完整行）、rewriteCount+1。 */
function rewriteFile(
  source: { day: string; absPath: string; sourceRel: string },
  previous: LedgerFileCursor,
  mirrorPath: string,
  stat: Stats,
  now: Date,
): FileSyncOutcome {
  const content = completeLinesOf(readFileSync(source.absPath, "utf8"));
  const scanned = scanVersions(content);
  writeFileSync(mirrorPath, content, { encoding: "utf8", mode: 0o600 });
  applyFileMode(mirrorPath, 0o600);
  const byteOffset = Buffer.byteLength(content, "utf8");
  return {
    action: "rewritten",
    linesAdded: lineCountOf(content),
    versionsSeen: scanned.seen,
    badLines: scanned.badLines,
    cursor: {
      byteOffset,
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs),
      lastSyncedAt: now.toISOString(),
      rewriteCount: previous.rewriteCount + 1,
      source: source.sourceRel,
      tailHash: hashTail(source.absPath, byteOffset),
    },
  };
}

/** 纯追加：从 byteOffset 读新增字节，截到最后一个 \n 写入镜像。 */
function appendNewBytes(
  source: { day: string; absPath: string; sourceRel: string },
  previous: LedgerFileCursor,
  mirrorPath: string,
  stat: Stats,
  now: Date,
): FileSyncOutcome {
  const start = previous.byteOffset;
  const end = stat.size;
  let appended = "";
  if (end > start) {
    const fd = openSync(source.absPath, "r");
    try {
      const buffer = Buffer.alloc(end - start);
      readSync(fd, buffer, 0, buffer.length, start);
      appended = completeLinesOf(buffer.toString("utf8"));
    } finally {
      closeSync(fd);
    }
    if (appended.length > 0) {
      // 追加写：模式与权限随已有镜像文件，写完统一收敛到 0o600。
      writeFileSync(mirrorPath, appended, { encoding: "utf8", flag: "a" });
      applyFileMode(mirrorPath, 0o600);
    }
  }
  const byteOffset = start + Buffer.byteLength(appended, "utf8");
  const scanned = scanVersions(appended);
  return {
    action: end > start ? "appended" : "unchanged",
    linesAdded: lineCountOf(appended),
    versionsSeen: scanned.seen,
    badLines: scanned.badLines,
    cursor: {
      byteOffset,
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs),
      lastSyncedAt: now.toISOString(),
      rewriteCount: previous.rewriteCount,
      source: source.sourceRel,
      tailHash: hashTail(source.absPath, byteOffset),
    },
  };
}

/** 截到最后一个完整行（保留结尾 \n）；尾部半行不拷。 */
function completeLinesOf(content: string): string {
  const lastNewline = content.lastIndexOf("\n");
  return lastNewline < 0 ? "" : content.slice(0, lastNewline + 1);
}

/** 一段"只含完整行"内容的行数（空串为 0）。 */
function lineCountOf(content: string): number {
  return content === "" ? 0 : content.split("\n").length - 1;
}

/**
 * 扫描一段镜像内容：统计各账本版本的行数（含 v 字段才计入），
 * 记录 1 起始的坏行行号。坏行不抛出——镜像照常写入，只告警。
 */
function scanVersions(content: string): {
  seen: Record<string, number>;
  seenTotal: number;
  badLines: number[];
} {
  const seen: Record<string, number> = {};
  const badLines: number[] = [];
  if (content === "") return { seen, seenTotal: 0, badLines };
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      badLines.push(i + 1);
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      badLines.push(i + 1);
      continue;
    }
    const version = (parsed as Partial<LedgerRecord>).v;
    if (typeof version === "number") {
      seen[String(version)] = (seen[String(version)] ?? 0) + 1;
    }
  }
  let seenTotal = 0;
  for (const count of Object.values(seen)) seenTotal += count;
  return { seen, seenTotal, badLines };
}

/** 官方文件 [max(0, offset-4096), offset) 区间的 sha256 指纹。 */
function hashTail(path: string, offset: number): string {
  const length = Math.min(TAIL_BYTES, offset);
  const buffer = Buffer.alloc(length);
  if (length > 0) {
    const fd = openSync(path, "r");
    try {
      readSync(fd, buffer, 0, length, offset - length);
    } finally {
      closeSync(fd);
    }
  }
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

/** 容错读 meta：不存在或损坏时返回初始状态（首 sync 全量复制）。 */
function readUsageMeta(path: string, sourceRoot: string): UsageMeta {
  let raw: unknown = null;
  if (existsSync(path)) {
    try {
      raw = readJson(path);
    } catch {
      raw = null;
    }
  }
  if (typeof raw !== "object" || raw === null) {
    return emptyMeta(sourceRoot);
  }
  const value = raw as Record<string, unknown>;
  const files =
    typeof value.files === "object" && value.files !== null
      ? (value.files as Record<string, LedgerFileCursor>)
      : {};
  const ledgerVersionsSeen =
    typeof value.ledgerVersionsSeen === "object" && value.ledgerVersionsSeen !== null
      ? (value.ledgerVersionsSeen as Record<string, number>)
      : {};
  return {
    schemaVersion: typeof value.schemaVersion === "number" ? value.schemaVersion : 1,
    lastSyncAt: typeof value.lastSyncAt === "string" ? value.lastSyncAt : "",
    sourceRoot,
    files,
    ledgerVersionsSeen,
    warnings: [],
  };
}

function emptyMeta(sourceRoot: string): UsageMeta {
  return {
    schemaVersion: 1,
    lastSyncAt: "",
    sourceRoot,
    files: {},
    ledgerVersionsSeen: {},
    warnings: [],
  };
}
