/**
 * Layer 1 文件库类型：小格、指针、tpd 日文件。
 */

import type { Layer1Level } from "../time.ts";

export type { Layer1Level };

/** 每个热力图库固定 336 个格子。 */
export const CELL_COUNT = 336;

export const TPD_RANGES = [7, 30, 90] as const;

export type TpdRange = (typeof TPD_RANGES)[number];

/** 一个时间桶的合计；cell 文件就是这一行的 NDJSON。 */
export interface Layer1Cell {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly webSearchRequests: number;
  /** cost.usd 合计；写入时保留到 6 位小数。 */
  readonly cost: number;
  /** 工具调用次数合计。 */
  readonly toolCalls: number;
}

/** `_meta_.json`：只做游标，不存统计。 */
export interface Layer1Meta {
  /** 官方账本格式版本；当前只支持 1。 */
  readonly v: number;
  /** 最后处理事件的时间；没有事件时为 0。 */
  readonly ts: number;
  /** 最后处理行的 sha256；没有事件时为空串。 */
  readonly hash: string;
}

export interface Layer1Point {
  readonly ts: number;
  readonly cell: Layer1Cell;
}

/** tpd 日文件：输入 + 输出 Token，按 surface 分面。 */
export interface TpdDayCell {
  readonly chat: number;
  readonly cowork: number;
  readonly code: number;
}

export interface TpdPoint {
  /** 本地日零点，UTC epoch 毫秒。 */
  readonly ts: number;
  /** 本地日期 YYYY-MM-DD。 */
  readonly day: string;
  readonly cell: TpdDayCell;
}

export interface LevelSyncResult {
  readonly level: Layer1Level;
  readonly action: "rebuilt" | "synced" | "unchanged";
  readonly eventsProcessed: number;
  readonly cellsWritten: number;
}

export interface TpdSyncResult {
  readonly range: TpdRange;
  readonly action: "rebuilt" | "synced" | "unchanged";
  readonly eventsProcessed: number;
  readonly filesWritten: number;
}

export interface Layer1SyncResult {
  readonly rebuiltLevels: readonly Layer1Level[];
  readonly eventsProcessed: number;
  readonly filesRead: number;
  readonly badLines: number;
  readonly partialLines: number;
  readonly unknownVersions: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
  readonly lastSyncAt: number;
}

export function emptyCell(): Layer1Cell {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    webSearchRequests: 0,
    cost: 0,
    toolCalls: 0,
  };
}

export function emptyTpdDay(): TpdDayCell {
  return { chat: 0, cowork: 0, code: 0 };
}

export function cellValue(cell: Layer1Cell): number {
  return cell.inputTokens + cell.outputTokens + cell.cacheReadTokens + cell.cacheWriteTokens;
}
