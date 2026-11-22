/**
 * 用量视图查询：只读 SQLite，不认 NDJSON。
 *
 * 热力图沿用旧分桶语义（336 格 newest-first）：
 * - 30min：最近 7 天，30 分钟桶；
 * - 1h：最近 14 天，1 小时桶；
 * - 1d：最近 336 天，本地日桶。
 * level 与旧实现一致：按该范围最大值的比例分 1–4 级，无数据为 0。
 */

import type { Database } from "../persistence/types.ts";

export interface UsageViewQuery {
  heatmapRange: "30min" | "1h" | "1d";
  dailyDays: 7 | 30 | 90;
}

export interface UsageBucketDetailDto {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly calls: number;
  readonly webSearchRequests: number;
}

export interface UsageBucketDto {
  /** 桶起点 ISO 8601。 */
  readonly start: string;
  /** 桶终点 ISO 8601。 */
  readonly end: string;
  /** 输入 + 输出 + 缓存读 + 缓存写。 */
  readonly value: number;
  readonly level: 0 | 1 | 2 | 3 | 4;
  /** 悬停提示，沿用旧格式（本地时间字符串）。 */
  readonly label: string;
  readonly detail: UsageBucketDetailDto;
}

export interface UsageDailyPointDto {
  /** 本地日期 YYYY-MM-DD。 */
  readonly day: string;
  readonly chat: number;
  readonly cowork: number;
  readonly code: number;
}

export interface UsageViewDto {
  readonly revision: number;
  /** usage_files.updated_at 的最大值；无文件为 null。 */
  readonly lastSyncedAt: string | null;
  /** 336 格，索引 0 = 最新。 */
  readonly heatmap: readonly UsageBucketDto[];
  /** 由远到近，包含缺失日的 0 值。 */
  readonly daily: readonly UsageDailyPointDto[];
  readonly warnings: readonly string[];
}

const CELLS = 336;
const RANGE_META = {
  "30min": { bucketMs: 30 * 60_000 },
  "1h": { bucketMs: 60 * 60_000 },
  "1d": { bucketMs: 24 * 60 * 60_000 },
} as const;

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function startOfLocalDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addLocalDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function localDayString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function bucketLabel(start: number): string {
  return new Date(start).toLocaleString("zh-CN", { hour12: false });
}

function levelFor(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4))) as 1 | 2 | 3 | 4;
}

function emptyDetail(): UsageBucketDetailDto {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    calls: 0,
    webSearchRequests: 0,
  };
}

function detailFrom(row: Record<string, unknown>): UsageBucketDetailDto {
  return {
    inputTokens: numberValue(row.input_tokens),
    outputTokens: numberValue(row.output_tokens),
    cacheReadTokens: numberValue(row.cache_read_tokens),
    cacheWriteTokens: numberValue(row.cache_write_tokens),
    calls: numberValue(row.calls),
    webSearchRequests: numberValue(row.web_search_requests),
  };
}

function totalOf(detail: UsageBucketDetailDto): number {
  return (
    detail.inputTokens + detail.outputTokens + detail.cacheReadTokens + detail.cacheWriteTokens
  );
}

function normalizeQuery(query: UsageViewQuery): UsageViewQuery {
  const heatmapRange =
    query.heatmapRange === "30min" || query.heatmapRange === "1h" || query.heatmapRange === "1d"
      ? query.heatmapRange
      : "30min";
  const dailyDays =
    query.dailyDays === 7 || query.dailyDays === 30 || query.dailyDays === 90
      ? query.dailyDays
      : 30;
  return { heatmapRange, dailyDays };
}

/** 读取用量视图；只读，不触发同步。 */
export function getUsageView(
  db: Database,
  query: UsageViewQuery,
  now: Date = new Date(),
): UsageViewDto {
  const normalized = normalizeQuery(query);
  const heatmap = buildHeatmap(db, normalized.heatmapRange, now);
  const daily = buildDaily(db, normalized.dailyDays, now);
  const revisionRow = db
    .prepare("SELECT value FROM app_meta WHERE key = 'usage_revision'")
    .get();
  const syncedRow = db
    .prepare("SELECT MAX(updated_at) AS at FROM usage_files")
    .get();
  return {
    revision: numberValue(revisionRow?.value),
    lastSyncedAt: typeof syncedRow?.at === "string" ? syncedRow.at : null,
    heatmap,
    daily,
    warnings: [],
  };
}

function buildHeatmap(
  db: Database,
  range: UsageViewQuery["heatmapRange"],
  now: Date,
): UsageBucketDto[] {
  return range === "1d" ? buildDailyBuckets(db, now) : buildMinuteBuckets(db, range, now);
}

function buildMinuteBuckets(
  db: Database,
  range: "30min" | "1h",
  now: Date,
): UsageBucketDto[] {
  const bucketMs = RANGE_META[range].bucketMs;
  const newest = Math.floor(now.getTime() / bucketMs) * bucketMs;
  const oldest = newest - (CELLS - 1) * bucketMs;
  const rows = db
    .prepare(
      `SELECT CAST(e.ts / ? AS INTEGER) AS bucket,
              COUNT(DISTINCT e.id) AS calls,
              COALESCE(SUM(m.input_tokens), 0) AS input_tokens,
              COALESCE(SUM(m.output_tokens), 0) AS output_tokens,
              COALESCE(SUM(m.cache_read_tokens), 0) AS cache_read_tokens,
              COALESCE(SUM(m.cache_write_tokens), 0) AS cache_write_tokens,
              COALESCE(SUM(m.web_search_requests), 0) AS web_search_requests
       FROM usage_events e
       LEFT JOIN usage_model_metrics m ON m.event_id = e.id
       WHERE e.ts >= ? AND e.ts < ?
       GROUP BY bucket`,
    )
    .all(bucketMs, oldest, newest + bucketMs) as Record<string, unknown>[];

  const byBucket = new Map<number, UsageBucketDetailDto>();
  for (const row of rows) {
    byBucket.set(numberValue(row.bucket) * bucketMs, detailFrom(row));
  }

  const details = Array.from({ length: CELLS }, (_, index) => {
    const start = newest - index * bucketMs;
    return { start, detail: byBucket.get(start) ?? emptyDetail() };
  });
  const max = Math.max(0, ...details.map((item) => totalOf(item.detail)));
  return details.map(({ start, detail }) => {
    const value = totalOf(detail);
    return {
      start: new Date(start).toISOString(),
      end: new Date(start + bucketMs).toISOString(),
      value,
      level: levelFor(value, max),
      label: bucketLabel(start),
      detail,
    };
  });
}

function buildDailyBuckets(db: Database, now: Date): UsageBucketDto[] {
  const today = startOfLocalDay(now);
  const days = Array.from({ length: CELLS }, (_, index) => addLocalDays(today, -index));
  const oldestDay = localDayString(days[days.length - 1] ?? today);
  const newestDay = localDayString(today);
  const rows = db
    .prepare(
      `SELECT e.day AS day,
              COUNT(DISTINCT e.id) AS calls,
              COALESCE(SUM(m.input_tokens), 0) AS input_tokens,
              COALESCE(SUM(m.output_tokens), 0) AS output_tokens,
              COALESCE(SUM(m.cache_read_tokens), 0) AS cache_read_tokens,
              COALESCE(SUM(m.cache_write_tokens), 0) AS cache_write_tokens,
              COALESCE(SUM(m.web_search_requests), 0) AS web_search_requests
       FROM usage_events e
       LEFT JOIN usage_model_metrics m ON m.event_id = e.id
       WHERE e.day >= ? AND e.day <= ?
       GROUP BY e.day`,
    )
    .all(oldestDay, newestDay) as Record<string, unknown>[];

  const byDay = new Map<string, UsageBucketDetailDto>();
  for (const row of rows) {
    byDay.set(String(row.day), detailFrom(row));
  }

  const details = days.map((date) => ({
    start: date.getTime(),
    end: addLocalDays(date, 1).getTime(),
    detail: byDay.get(localDayString(date)) ?? emptyDetail(),
  }));
  const max = Math.max(0, ...details.map((item) => totalOf(item.detail)));
  return details.map(({ start, end, detail }) => {
    const value = totalOf(detail);
    return {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      value,
      level: levelFor(value, max),
      label: bucketLabel(start),
      detail,
    };
  });
}

function buildDaily(
  db: Database,
  dailyDays: UsageViewQuery["dailyDays"],
  now: Date,
): UsageDailyPointDto[] {
  const today = startOfLocalDay(now);
  const dates = Array.from({ length: dailyDays }, (_, index) =>
    addLocalDays(today, -(dailyDays - 1 - index)),
  );
  const oldestDay = localDayString(dates[0] ?? today);
  const newestDay = localDayString(today);
  const rows = db
    .prepare(
      `SELECT e.day AS day,
              e.surface AS surface,
              COALESCE(SUM(m.input_tokens), 0) + COALESCE(SUM(m.output_tokens), 0) AS tokens
       FROM usage_events e
       LEFT JOIN usage_model_metrics m ON m.event_id = e.id
       WHERE e.day >= ? AND e.day <= ?
       GROUP BY e.day, e.surface`,
    )
    .all(oldestDay, newestDay) as Record<string, unknown>[];

  const byDay = new Map<string, { chat: number; cowork: number; code: number }>();
  for (const row of rows) {
    const day = String(row.day);
    const surface = String(row.surface);
    if (surface !== "chat" && surface !== "cowork" && surface !== "code") continue;
    const entry = byDay.get(day) ?? { chat: 0, cowork: 0, code: 0 };
    entry[surface] += numberValue(row.tokens);
    byDay.set(day, entry);
  }

  return dates.map((date) => {
    const day = localDayString(date);
    const entry = byDay.get(day) ?? { chat: 0, cowork: 0, code: 0 };
    return { day, chat: entry.chat, cowork: entry.cowork, code: entry.code };
  });
}
