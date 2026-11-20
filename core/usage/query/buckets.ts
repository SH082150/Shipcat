/**
 * 分桶聚合：把镜像账本压成固定 336 格，索引 0 = 最新，索引 335 = 最老。
 * 供 UI 热力图左上角最新、右下角最老的队列式排列使用。
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveHome } from "../../platform/index.ts";
import { ledgerDir } from "../paths/index.ts";
import type { AggregateUsageOptions } from "./index.ts";

export type UsageBucketRange = "30min" | "1h" | "1d";

export interface UsageBucket {
  /** 桶起点毫秒时间戳。 */
  readonly start: number;
  /** 桶内记录的 token 总量（输入 + 输出 + 缓存读写）。 */
  readonly value: number | null;
  /** 0–4 展示强度。 */
  readonly level: number;
  readonly label: string;
}

const BUCKET_MINUTES: Record<UsageBucketRange, number> = { "30min": 30, "1h": 60, "1d": 1440 };
const CELLS = 336;

export interface AggregateBucketOptions extends AggregateUsageOptions {
  /** 缺省当前时间；索引 0 是包含 now 的桶。 */
  readonly now?: Date;
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
  const totals = new Map<number, number>();

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
      const record = raw as { v?: unknown; ts?: unknown; models?: unknown };
      if (record.v !== 1 || typeof record.ts !== "number" || typeof record.models !== "object") continue;
      const bucket = Math.floor(record.ts / bucketMs) * bucketMs;
      if (bucket < oldest || bucket > newest) continue;
      let value = 0;
      for (const usage of Object.values(record.models as Record<string, unknown>)) {
        if (typeof usage !== "object" || usage === null) continue;
        const m = usage as Record<string, unknown>;
        value += number(m.inputTokens) + number(m.outputTokens) + number(m.cacheReadTokens) + number(m.cacheWriteTokens);
      }
      totals.set(bucket, (totals.get(bucket) ?? 0) + value);
    }
  }

  const max = Math.max(0, ...totals.values());
  return Array.from({ length: CELLS }, (_, index) => {
    const start = newest - index * bucketMs;
    const value = totals.get(start);
    const level = value === undefined || value === 0 || max === 0 ? 0 : Math.min(4, Math.ceil((value / max) * 4));
    return {
      start,
      value: value === undefined ? null : value,
      level,
      label: new Date(start).toLocaleString("zh-CN", { hour12: false }),
    };
  });
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
