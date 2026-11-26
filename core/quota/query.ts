/**
 * 额度窗口查询：直接读 Monitor 的 Layer 1 日文件，按滚动窗口求和。
 *
 * 不建新库、不做增量聚合；Monitor 已经负责采集与去重，这里只做时间过滤。
 */

import { QUOTA_WINDOWS, sumQuotaWindows } from "./windows.ts";
import type { QuotaWindowSummary } from "./windows.ts";
import { readRecentMonitorRecords } from "../monitor/query.ts";

/** 默认读取上限，与主进程 Monitor 缓存保持一致。 */
export const QUOTA_RECORD_LIMIT = 50_000;

export interface QuotaQueryOptions {
  readonly now?: number;
  readonly providers?: readonly string[] | null;
  readonly limit?: number;
}

export interface QuotaSnapshot {
  readonly now: number;
  readonly windows: readonly QuotaWindowSummary[];
  /** 实际参与统计的最早记录时间；没有记录为 null。 */
  readonly coverageStart: number | null;
  /** 读取达到上限且覆盖不足最宽窗口时为 true，避免静默少算。 */
  readonly truncated: boolean;
}

/** 读取 Monitor 记录并返回 5h / 7d / 30d 三个窗口的汇总。 */
export function queryQuotaWindows(root: string, options: QuotaQueryOptions = {}): QuotaSnapshot {
  const now = options.now ?? Date.now();
  const limit = options.limit ?? QUOTA_RECORD_LIMIT;
  const records = readRecentMonitorRecords(root, limit);
  const windows = sumQuotaWindows(records, {
    now,
    providers: options.providers ?? null,
  });
  const coverageStart = records[0]?.ts ?? null;
  const widest = QUOTA_WINDOWS[QUOTA_WINDOWS.length - 1];
  const truncated =
    records.length >= limit &&
    coverageStart !== null &&
    widest !== undefined &&
    coverageStart > now - widest.durationMs;

  return { now, windows, coverageStart, truncated };
}
