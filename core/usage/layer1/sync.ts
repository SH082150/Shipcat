/**
 * Layer 1 同步：按 `_meta_` 游标从新到旧读官方账本，写固定 336 格的 cell；
 * tpd 三个范围各自维护本地日文件。
 *
 * 规则：
 * - 每次同步都按当前本地时间滚窗口、补零、删除窗口外旧桶；
 * - `_meta_.ts/hash` 只随新事件前进，空闲滚窗口绝不覆盖；
 * - 同 ts 用行 hash 判断迟到行；
 * - 崩溃（`_syncing_` 残留或 meta 不完整）→ 整库重建。
 */

import {
  createScanStats,
  LEDGER_VERSION,
  scanLedgerNewestFirst,
} from "../ledger.ts";
import type { LedgerEvent, LedgerScanStats } from "../ledger.ts";
import { localBucketStart, localDayStart, windowStarts } from "../time.ts";
import type { Layer1Level } from "../time.ts";
import { cellFile, levelDir, tpdDir, tpdFile } from "./paths.ts";
import {
  cellStarts,
  clearSyncing,
  ensureDir,
  hasSyncing,
  markSyncing,
  readCell,
  readMeta,
  readTpdDay,
  resetDir,
  writeCell,
  writeMeta,
  writeTpdDay,
} from "./store.ts";
import { emptyCell, emptyTpdDay } from "./types.ts";
import type {
  Layer1Cell,
  LevelSyncResult,
  TpdDayCell,
  TpdRange,
  TpdSyncResult,
} from "./types.ts";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

interface Accumulator {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearchRequests: number;
  costMicroUsd: number;
  toolCalls: number;
}

function emptyAccumulator(): Accumulator {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    webSearchRequests: 0,
    costMicroUsd: 0,
    toolCalls: 0,
  };
}

function addEvent(target: Accumulator, event: LedgerEvent): void {
  target.inputTokens += event.inputTokens;
  target.outputTokens += event.outputTokens;
  target.cacheReadTokens += event.cacheReadTokens;
  target.cacheWriteTokens += event.cacheWriteTokens;
  target.webSearchRequests += event.webSearchRequests;
  target.costMicroUsd += event.costMicroUsd;
  target.toolCalls += event.toolCalls;
}

function accumulatorOfCell(cell: Layer1Cell): Accumulator {
  return {
    inputTokens: cell.inputTokens,
    outputTokens: cell.outputTokens,
    cacheReadTokens: cell.cacheReadTokens,
    cacheWriteTokens: cell.cacheWriteTokens,
    webSearchRequests: cell.webSearchRequests,
    costMicroUsd: Math.round(cell.cost * 1_000_000),
    toolCalls: cell.toolCalls,
  };
}

function cellOfAccumulator(acc: Accumulator): Layer1Cell {
  return {
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    cacheReadTokens: acc.cacheReadTokens,
    cacheWriteTokens: acc.cacheWriteTokens,
    webSearchRequests: acc.webSearchRequests,
    cost: acc.costMicroUsd / 1_000_000,
    toolCalls: acc.toolCalls,
  };
}

function mergeInto(target: Accumulator, source: Accumulator): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cacheReadTokens += source.cacheReadTokens;
  target.cacheWriteTokens += source.cacheWriteTokens;
  target.webSearchRequests += source.webSearchRequests;
  target.costMicroUsd += source.costMicroUsd;
  target.toolCalls += source.toolCalls;
}

function validMeta(meta: ReturnType<typeof readMeta>): meta is NonNullable<ReturnType<typeof readMeta>> {
  return meta !== null && meta.v === LEDGER_VERSION && typeof meta.hash === "string";
}

function removeOutside(dir: string, keep: ReadonlySet<number>, starts: readonly number[]): void {
  for (const ts of starts) {
    if (keep.has(ts)) continue;
    rmSync(join(dir, `${ts}.ndjson`), { force: true });
  }
}

export interface SyncLevelOptions {
  readonly root: string;
  readonly sourceRoot: string;
  readonly level: Layer1Level;
  readonly timezone: string;
  /** 注入“现在”，UTC epoch 毫秒。 */
  readonly now: number;
  readonly stats?: LedgerScanStats;
}

/** 同步一个热力图库；返回本轮处理结果。 */
export function syncLevel(options: SyncLevelOptions): LevelSyncResult {
  const { root, sourceRoot, level, timezone, now } = options;
  const stats = options.stats ?? createScanStats();
  const dir = levelDir(root, level);
  ensureDir(dir);
  const meta = readMeta(dir);
  if (hasSyncing(dir) || !validMeta(meta)) {
    return rebuildLevel({ ...options, stats }, dir);
  }
  return incrementalLevel({ ...options, stats }, dir, meta);
}

function incrementalLevel(
  options: SyncLevelOptions & { readonly stats: LedgerScanStats },
  dir: string,
  meta: NonNullable<ReturnType<typeof readMeta>>,
): LevelSyncResult {
  const { root, sourceRoot, level, timezone, now, stats } = options;
  markSyncing(dir, "sync");
  try {
    const starts = windowStarts(level, now, timezone);
    const newest = starts[0] ?? 0;
    const oldest = starts[starts.length - 1] ?? 0;
    const keep = new Set(starts);
    const deltas = new Map<number, Accumulator>();
    let firstProcessed: { ts: number; hash: string } | null = null;
    let processed = 0;

    for (const event of scanLedgerNewestFirst(sourceRoot, stats)) {
      if (event.ts < meta.ts) break;
      if (event.ts === meta.ts && event.hash === meta.hash) break;
      const bucket = localBucketStart(event.ts, level, timezone);
      if (bucket > newest) continue;
      if (bucket < oldest) break;
      const acc = deltas.get(bucket) ?? emptyAccumulator();
      addEvent(acc, event);
      deltas.set(bucket, acc);
      processed += 1;
      if (firstProcessed === null) firstProcessed = { ts: event.ts, hash: event.hash };
    }

    for (const ts of starts) {
      const path = cellFile(root, level, ts);
      if (!existsSync(path)) writeCell(path, emptyCell());
    }
    removeOutside(dir, keep, cellStarts(dir));

    let cellsWritten = 0;
    for (const [bucket, acc] of deltas) {
      const path = cellFile(root, level, bucket);
      const existing = readCell(path);
      const merged = existing === null ? acc : accumulatorOfCell(existing);
      if (existing !== null) mergeInto(merged, acc);
      writeCell(path, cellOfAccumulator(merged));
      cellsWritten += 1;
    }

    if (firstProcessed !== null) {
      writeMeta(dir, { v: LEDGER_VERSION, ts: firstProcessed.ts, hash: firstProcessed.hash });
    }

    return {
      level,
      action: processed === 0 ? "unchanged" : "synced",
      eventsProcessed: processed,
      cellsWritten,
    };
  } finally {
    clearSyncing(dir);
  }
}

function rebuildLevel(
  options: SyncLevelOptions & { readonly stats: LedgerScanStats },
  dir: string,
): LevelSyncResult {
  const { root, sourceRoot, level, timezone, now, stats } = options;
  resetDir(dir);
  markSyncing(dir, "rebuild");
  try {
    const starts = windowStarts(level, now, timezone);
    const newest = starts[0] ?? 0;
    const oldest = starts[starts.length - 1] ?? 0;
    for (const ts of starts) writeCell(cellFile(root, level, ts), emptyCell());

    const deltas = new Map<number, Accumulator>();
    let firstProcessed: { ts: number; hash: string } | null = null;
    let processed = 0;
    for (const event of scanLedgerNewestFirst(sourceRoot, stats)) {
      const bucket = localBucketStart(event.ts, level, timezone);
      if (bucket > newest) continue;
      if (bucket < oldest) break;
      const acc = deltas.get(bucket) ?? emptyAccumulator();
      addEvent(acc, event);
      deltas.set(bucket, acc);
      processed += 1;
      if (firstProcessed === null) firstProcessed = { ts: event.ts, hash: event.hash };
    }

    for (const [bucket, acc] of deltas) {
      writeCell(cellFile(root, level, bucket), cellOfAccumulator(acc));
    }
    writeMeta(
      dir,
      firstProcessed === null
        ? { v: LEDGER_VERSION, ts: 0, hash: "" }
        : { v: LEDGER_VERSION, ts: firstProcessed.ts, hash: firstProcessed.hash },
    );

    return {
      level,
      action: "rebuilt",
      eventsProcessed: processed,
      cellsWritten: deltas.size,
    };
  } finally {
    clearSyncing(dir);
  }
}

export interface SyncTpdOptions {
  readonly root: string;
  readonly sourceRoot: string;
  readonly range: TpdRange;
  readonly timezone: string;
  readonly now: number;
  readonly stats?: LedgerScanStats;
}

/** 同步一个 tpd 范围（tp7d / tp30d / tp90d）。 */
export function syncTpd(options: SyncTpdOptions): TpdSyncResult {
  const { root, sourceRoot, range, timezone, now } = options;
  const stats = options.stats ?? createScanStats();
  const dir = tpdDir(root, range);
  ensureDir(dir);
  const meta = readMeta(dir);
  if (hasSyncing(dir) || !validMeta(meta)) {
    return rebuildTpd({ ...options, stats }, dir);
  }
  return incrementalTpd({ ...options, stats }, dir, meta);
}

function addTpdEvent(target: TpdDayCell, event: LedgerEvent): TpdDayCell {
  const tokens = event.inputTokens + event.outputTokens;
  if (tokens === 0) return target;
  if (event.surface === "chat") return { ...target, chat: target.chat + tokens };
  if (event.surface === "cowork") return { ...target, cowork: target.cowork + tokens };
  if (event.surface === "code") return { ...target, code: target.code + tokens };
  return target;
}

function addTpdCells(a: TpdDayCell, b: TpdDayCell): TpdDayCell {
  return { chat: a.chat + b.chat, cowork: a.cowork + b.cowork, code: a.code + b.code };
}

function incrementalTpd(
  options: SyncTpdOptions & { readonly stats: LedgerScanStats },
  dir: string,
  meta: NonNullable<ReturnType<typeof readMeta>>,
): TpdSyncResult {
  const { root, sourceRoot, range, timezone, now, stats } = options;
  markSyncing(dir, "sync");
  try {
    const starts = windowStarts("1d", now, timezone, range);
    const newest = starts[0] ?? 0;
    const oldest = starts[starts.length - 1] ?? 0;
    const keep = new Set(starts);
    const deltas = new Map<number, TpdDayCell>();
    let firstProcessed: { ts: number; hash: string } | null = null;
    let processed = 0;

    for (const event of scanLedgerNewestFirst(sourceRoot, stats)) {
      if (event.ts < meta.ts) break;
      if (event.ts === meta.ts && event.hash === meta.hash) break;
      const day = localDayStart(event.ts, timezone);
      if (day > newest) continue;
      if (day < oldest) break;
      deltas.set(day, addTpdEvent(deltas.get(day) ?? emptyTpdDay(), event));
      processed += 1;
      if (firstProcessed === null) firstProcessed = { ts: event.ts, hash: event.hash };
    }

    for (const ts of starts) {
      const path = tpdFile(root, range, ts);
      if (!existsSync(path)) writeTpdDay(path, emptyTpdDay());
    }
    removeOutside(dir, keep, cellStarts(dir));

    let filesWritten = 0;
    for (const [day, delta] of deltas) {
      const path = tpdFile(root, range, day);
      const existing = readTpdDay(path);
      writeTpdDay(path, existing === null ? delta : addTpdCells(existing, delta));
      filesWritten += 1;
    }

    if (firstProcessed !== null) {
      writeMeta(dir, { v: LEDGER_VERSION, ts: firstProcessed.ts, hash: firstProcessed.hash });
    }

    return {
      range,
      action: processed === 0 ? "unchanged" : "synced",
      eventsProcessed: processed,
      filesWritten,
    };
  } finally {
    clearSyncing(dir);
  }
}

function rebuildTpd(
  options: SyncTpdOptions & { readonly stats: LedgerScanStats },
  dir: string,
): TpdSyncResult {
  const { root, sourceRoot, range, timezone, now, stats } = options;
  resetDir(dir);
  markSyncing(dir, "rebuild");
  try {
    const starts = windowStarts("1d", now, timezone, range);
    const newest = starts[0] ?? 0;
    const oldest = starts[starts.length - 1] ?? 0;
    for (const ts of starts) writeTpdDay(tpdFile(root, range, ts), emptyTpdDay());

    const deltas = new Map<number, TpdDayCell>();
    let firstProcessed: { ts: number; hash: string } | null = null;
    let processed = 0;
    for (const event of scanLedgerNewestFirst(sourceRoot, stats)) {
      const day = localDayStart(event.ts, timezone);
      if (day > newest) continue;
      if (day < oldest) break;
      deltas.set(day, addTpdEvent(deltas.get(day) ?? emptyTpdDay(), event));
      processed += 1;
      if (firstProcessed === null) firstProcessed = { ts: event.ts, hash: event.hash };
    }

    for (const [day, cell] of deltas) {
      writeTpdDay(tpdFile(root, range, day), cell);
    }
    writeMeta(
      dir,
      firstProcessed === null
        ? { v: LEDGER_VERSION, ts: 0, hash: "" }
        : { v: LEDGER_VERSION, ts: firstProcessed.ts, hash: firstProcessed.hash },
    );

    return {
      range,
      action: "rebuilt",
      eventsProcessed: processed,
      filesWritten: deltas.size,
    };
  } finally {
    clearSyncing(dir);
  }
}
