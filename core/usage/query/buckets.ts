/**
 * 分桶聚合：把镜像账本压成固定 336 格，索引 0 = 最新，索引 335 = 最老。
 * 供 UI 热力图左上角最新、右下角最老的队列式排列使用。
 *
 * 每格除总量外还带一份明细（输入/输出/缓存读写、调用、错误、成本、
 * 网页搜索、各模型 token、各界面调用），供 UI 悬停时展示单格统计。
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveHome } from "../../platform/index.ts";
import { ledgerDir } from "../paths/index.ts";
import type { AggregateUsageOptions } from "./index.ts";

export type UsageBucketRange = "30min" | "1h" | "1d";

/** 单格明细；字段只保留 UI 实际展示且账本能直接读出的项。 */
export interface UsageBucketDetail {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly webSearchRequests: number;
  readonly calls: number;
  readonly errors: number;
  readonly costUsd: number;
  /** 模型名 → 该格总 token（输入 + 输出 + 缓存读写）。 */
  readonly models: Readonly<Record<string, number>>;
  /** 界面 → 该格调用次数。 */
  readonly surfaces: Readonly<Record<string, number>>;
}

export interface UsageBucket {
  /** 桶起点毫秒时间戳。 */
  readonly start: number;
  /** 桶内记录的 token 总量（输入 + 输出 + 缓存读写）。 */
  readonly value: number | null;
  /** 0–4 展示强度。 */
  readonly level: number;
  readonly label: string;
  /** 该格明细；完全没有记录时为 null。 */
  readonly detail: UsageBucketDetail | null;
}

const BUCKET_MINUTES: Record<UsageBucketRange, number> = { "30min": 30, "1h": 60, "1d": 1440 };
const CELLS = 336;

export interface AggregateBucketOptions extends AggregateUsageOptions {
  /** 缺省当前时间；索引 0 是包含 now 的桶。 */
  readonly now?: Date;
}

interface BucketAccumulator {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearchRequests: number;
  calls: number;
  errors: number;
  costUsd: number;
  models: Map<string, number>;
  surfaces: Map<string, number>;
}

/** 读取镜像账本，得到 336 格 newest-first 的分桶。 */
export function aggregateUsageBuckets(
  range: UsageBucketRange,
  options: AggregateBucketOptions = {},
): UsageBucket[] {
  const bucketMs = BUCKET_MINUTES[range] * 60_000;
  const now = (options.now ?? new Date()).getTime();
  const newest = Math.floor(now / bucketMs) * bucketMs;
  const oldest = newest - (CELLS - 1) * bucketMs;
  const totals = new Map<number, BucketAccumulator>();

  const root = ledgerDir(options.home ?? resolveHome());
  for (const file of listFiles(root)) {
    let content = "";
    try {
      content = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      if (line === "") continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof raw !== "object" || raw === null) continue;
      const record = raw as {
        v?: unknown;
        ts?: unknown;
        surface?: unknown;
        isError?: unknown;
        models?: unknown;
      };
      if (record.v !== 1 || typeof record.ts !== "number" || typeof record.models !== "object") continue;
      if (record.models === null) continue;
      const bucket = Math.floor(record.ts / bucketMs) * bucketMs;
      if (bucket < oldest || bucket > newest) continue;

      const accumulator = totals.get(bucket) ?? emptyAccumulator();
      accumulate(accumulator, record.surface, record.isError, record.models);
      totals.set(bucket, accumulator);
    }
  }

  const max = Math.max(0, ...[...totals.values()].map(totalTokens));
  return Array.from({ length: CELLS }, (_, index) => {
    const start = newest - index * bucketMs;
    const accumulator = totals.get(start);
    const value = accumulator ? totalTokens(accumulator) : undefined;
    const level = value === undefined || value === 0 || max === 0 ? 0 : Math.min(4, Math.ceil((value / max) * 4));
    return {
      start,
      value: value === undefined ? null : value,
      level,
      label: new Date(start).toLocaleString("zh-CN", { hour12: false }),
      detail: accumulator ? toDetail(accumulator) : null,
    };
  });
}

function emptyAccumulator(): BucketAccumulator {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    webSearchRequests: 0,
    calls: 0,
    errors: 0,
    costUsd: 0,
    models: new Map(),
    surfaces: new Map(),
  };
}

function accumulate(
  accumulator: BucketAccumulator,
  surface: unknown,
  isError: unknown,
  models: object,
): void {
  accumulator.calls += 1;
  if (isError === true) accumulator.errors += 1;
  if (typeof surface === "string" && surface !== "") {
    accumulator.surfaces.set(surface, (accumulator.surfaces.get(surface) ?? 0) + 1);
  }

  for (const [name, usage] of Object.entries(models as Record<string, unknown>)) {
    if (typeof usage !== "object" || usage === null) continue;
    const entry = usage as Record<string, unknown>;
    const input = number(entry.inputTokens);
    const output = number(entry.outputTokens);
    const cacheRead = number(entry.cacheReadTokens);
    const cacheWrite = number(entry.cacheWriteTokens);
    const tokens = input + output + cacheRead + cacheWrite;

    accumulator.inputTokens += input;
    accumulator.outputTokens += output;
    accumulator.cacheReadTokens += cacheRead;
    accumulator.cacheWriteTokens += cacheWrite;
    accumulator.webSearchRequests += number(entry.webSearchRequests);
    accumulator.costUsd += costOf(entry.cost);
    if (tokens > 0) accumulator.models.set(name, (accumulator.models.get(name) ?? 0) + tokens);
  }
}

function costOf(raw: unknown): number {
  if (typeof raw !== "object" || raw === null) return 0;
  return number((raw as { usd?: unknown }).usd);
}

function totalTokens(accumulator: BucketAccumulator): number {
  return (
    accumulator.inputTokens +
    accumulator.outputTokens +
    accumulator.cacheReadTokens +
    accumulator.cacheWriteTokens
  );
}

/** Map → 普通对象，模型按 token 降序，保证输出稳定。 */
function toDetail(accumulator: BucketAccumulator): UsageBucketDetail {
  const models: Record<string, number> = {};
  for (const [name, tokens] of [...accumulator.models.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )) {
    models[name] = tokens;
  }
  return {
    inputTokens: accumulator.inputTokens,
    outputTokens: accumulator.outputTokens,
    cacheReadTokens: accumulator.cacheReadTokens,
    cacheWriteTokens: accumulator.cacheWriteTokens,
    webSearchRequests: accumulator.webSearchRequests,
    calls: accumulator.calls,
    errors: accumulator.errors,
    costUsd: accumulator.costUsd,
    models,
    surfaces: Object.fromEntries(accumulator.surfaces),
  };
}

function listFiles(root: string): string[] {
  try {
    return readdirSync(root)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(name))
      .sort();
  } catch {
    return [];
  }
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
