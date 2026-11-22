/**
 * 单文件增量判定与事务编排。
 *
 * 判定顺序与旧 mirror 一致：size 变小 / 尾指纹缺失 / 尾指纹不匹配 → 重写；
 * 文件大小未变 → unchanged；否则从 byteOffset 追加完整行。每个结果都在
 * 一个事务内完成“事件 + 映射 + 指标 + 游标 + usage_revision”。
 */

import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import type { Stats } from "node:fs";

import { withTransaction } from "../../persistence/index.ts";
import type { Database } from "../../persistence/types.ts";
import { KNOWN_LEDGER_VERSION } from "../types/index.ts";
import { parseLedgerLine } from "./source.ts";
import * as store from "./store.ts";
import type {
  FileOutcome,
  ParsedLedgerEvent,
  ParseLineResult,
  SourceFile,
} from "./types.ts";

const TAIL_BYTES = 4096;

export interface SyncFileOptions {
  readonly db: Database;
  readonly sourceId: string;
  readonly file: SourceFile;
  readonly now: Date;
  /** 事务提交成功后回调新的 usage_revision；unchanged 不触发。 */
  readonly onCommitted?: (revision: number) => void;
}

export function syncFile(options: SyncFileOptions): FileOutcome {
  const { db, sourceId, file, now } = options;
  const nowIso = now.toISOString();

  let stat: Stats;
  try {
    stat = statSync(file.absPath);
  } catch (error) {
    return skipped(file, sourceId, `文件无法读取：${messageOf(error)}`);
  }

  const previous = store.getFileCursor(db, sourceId, file.sourcePath);
  if (previous !== null) {
    if (stat.size < previous.byteOffset) {
      return rewrite(options, previous, stat, nowIso);
    }
    if (previous.tailHash === null) {
      return rewrite(options, previous, stat, nowIso);
    }
    if (hashTail(file.absPath, previous.byteOffset) !== previous.tailHash) {
      return rewrite(options, previous, stat, nowIso);
    }
    if (stat.size === previous.fileSize) {
      return unchanged(file, sourceId);
    }
    return append(options, previous, stat, nowIso);
  }

  return importNew(options, stat, nowIso);
}

interface ParsedChunk {
  readonly events: readonly ParsedLedgerEvent[];
  readonly warnings: readonly string[];
  readonly unknownVersions: Readonly<Record<string, number>>;
  readonly lineCount: number;
}

function importNew(
  options: SyncFileOptions,
  stat: Stats,
  nowIso: string,
): FileOutcome {
  const { db, sourceId, file } = options;
  const complete = completeLinesOf(readFileSync(file.absPath, "utf8"));
  const parsed = parseChunk(complete, file.sourceRel, 1);
  const revision = 1;
  const byteOffset = Buffer.byteLength(complete, "utf8");
  let committedRevision = 0;
  let stats: store.BatchStats = emptyStats();

  withTransaction(db, () => {
    stats = store.appendBatch(db, {
      sourceId,
      sourcePath: file.sourcePath,
      revision,
      createdAt: nowIso,
      events: parsed.events,
    });
    store.saveFileState(db, {
      sourceId,
      sourcePath: file.sourcePath,
      day: file.day,
      byteOffset,
      fileSize: stat.size,
      tailHash: hashTail(file.absPath, byteOffset),
      revision,
      updatedAt: nowIso,
    });
    committedRevision = store.bumpRevision(db);
  });
  options.onCommitted?.(committedRevision);
  return outcomeFrom(file, sourceId, "new", parsed, stats);
}

function rewrite(
  options: SyncFileOptions,
  previous: store.FileCursor,
  stat: Stats,
  nowIso: string,
): FileOutcome {
  const { db, sourceId, file } = options;
  const complete = completeLinesOf(readFileSync(file.absPath, "utf8"));
  const parsed = parseChunk(complete, file.sourceRel, 1);
  const revision = previous.revision + 1;
  const byteOffset = Buffer.byteLength(complete, "utf8");
  let committedRevision = 0;
  let stats: store.BatchStats = emptyStats();

  withTransaction(db, () => {
    store.deleteSourceMappings(db, sourceId, file.sourcePath);
    stats = store.appendBatch(db, {
      sourceId,
      sourcePath: file.sourcePath,
      revision,
      createdAt: nowIso,
      events: parsed.events,
    });
    store.deleteOrphanEvents(db);
    store.saveFileState(db, {
      sourceId,
      sourcePath: file.sourcePath,
      day: file.day,
      byteOffset,
      fileSize: stat.size,
      tailHash: hashTail(file.absPath, byteOffset),
      revision,
      updatedAt: nowIso,
    });
    committedRevision = store.bumpRevision(db);
  });
  options.onCommitted?.(committedRevision);
  return outcomeFrom(file, sourceId, "rewritten", parsed, stats);
}

function append(
  options: SyncFileOptions,
  previous: store.FileCursor,
  stat: Stats,
  nowIso: string,
): FileOutcome {
  const { db, sourceId, file } = options;
  const appended =
    stat.size > previous.byteOffset
      ? completeLinesOf(readSlice(file.absPath, previous.byteOffset, stat.size))
      : "";
  const parsed = parseChunk(appended, file.sourceRel, 1);
  const revision = previous.revision + 1;
  const byteOffset = previous.byteOffset + Buffer.byteLength(appended, "utf8");
  let committedRevision = 0;
  let stats: store.BatchStats = emptyStats();

  withTransaction(db, () => {
    stats = store.appendBatch(db, {
      sourceId,
      sourcePath: file.sourcePath,
      revision,
      createdAt: nowIso,
      events: parsed.events,
    });
    store.saveFileState(db, {
      sourceId,
      sourcePath: file.sourcePath,
      day: file.day,
      byteOffset,
      fileSize: stat.size,
      tailHash: hashTail(file.absPath, byteOffset),
      revision,
      updatedAt: nowIso,
    });
    committedRevision = store.bumpRevision(db);
  });
  options.onCommitted?.(committedRevision);
  return outcomeFrom(file, sourceId, "appended", parsed, stats);
}

function emptyStats(): store.BatchStats {
  return { eventsAdded: 0, eventsReused: 0, mappingsAdded: 0, metricsWritten: 0 };
}

function outcomeFrom(
  file: SourceFile,
  sourceId: string,
  action: FileOutcome["action"],
  parsed: ParsedChunk,
  stats: store.BatchStats,
): FileOutcome {
  return {
    sourceId,
    sourcePath: file.sourcePath,
    day: file.day,
    action,
    linesAdded: parsed.lineCount,
    eventsAdded: stats.eventsAdded,
    eventsReused: stats.eventsReused,
    mappingsAdded: stats.mappingsAdded,
    metricsWritten: stats.metricsWritten,
    warnings: parsed.warnings,
    unknownVersions: parsed.unknownVersions,
  };
}

function unchanged(file: SourceFile, sourceId: string): FileOutcome {
  return {
    sourceId,
    sourcePath: file.sourcePath,
    day: file.day,
    action: "unchanged",
    linesAdded: 0,
    eventsAdded: 0,
    eventsReused: 0,
    mappingsAdded: 0,
    metricsWritten: 0,
    warnings: [],
    unknownVersions: {},
  };
}

function skipped(file: SourceFile, sourceId: string, warning: string): FileOutcome {
  return {
    sourceId,
    sourcePath: file.sourcePath,
    day: file.day,
    action: "skipped",
    linesAdded: 0,
    eventsAdded: 0,
    eventsReused: 0,
    mappingsAdded: 0,
    metricsWritten: 0,
    warnings: [warning],
    unknownVersions: {},
  };
}

function parseChunk(content: string, sourceRel: string, firstLine: number): ParsedChunk {
  const events: ParsedLedgerEvent[] = [];
  const warnings: string[] = [];
  const unknownVersions: Record<string, number> = {};
  if (content.length === 0) {
    return { events, warnings, unknownVersions, lineCount: 0 };
  }

  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) continue;
    const parsed: ParseLineResult = parseLedgerLine(line);
    if (parsed.kind === "empty") continue;
    if (parsed.kind === "bad") {
      warnings.push(
        `文件 ${sourceRel} 第 ${firstLine + index} 行解析失败：${parsed.reason}`,
      );
      continue;
    }
    events.push(parsed.event);
    if (parsed.event.version !== KNOWN_LEDGER_VERSION) {
      const key = String(parsed.event.version);
      unknownVersions[key] = (unknownVersions[key] ?? 0) + 1;
    }
  }

  return {
    events,
    warnings,
    unknownVersions,
    lineCount: Math.max(0, lines.length - 1),
  };
}

/** 截到最后一个完整行（保留结尾 \n）；尾部半行不处理。 */
function completeLinesOf(content: string): string {
  const lastNewline = content.lastIndexOf("\n");
  return lastNewline < 0 ? "" : content.slice(0, lastNewline + 1);
}

/** 读取文件 [start, end) 字节并解码。 */
function readSlice(path: string, start: number, end: number): string {
  if (end <= start) return "";
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(end - start);
    const read = readSync(fd, buffer, 0, buffer.length, start);
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** 文件 [max(0, offset-4096), offset) 区间的 sha256 指纹。 */
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
