/**
 * 聚合查询：只读本地镜像账本（绝不读官方目录），按
 * 天 × surface × 模型 聚合用量。
 *
 * - day/from/to 按记录 ts 转本地日期字符串（YYYY-MM-DD，与镜像文件名同格式）比较；
 * - surface/origin 精确匹配；model 过滤 = 只保留 models 含该键的行，且只算该模型；
 * - 一行多模型键全量累加；calls：totals 计行数，per model 计含该模型的行数；
 * - costUsd 累加 cost?.usd ?? 0，缺失不报错；
 * - 未知版本（≠ KNOWN_LEDGER_VERSION）的行跳过不聚合；
 * - 坏行静默跳过（sync 阶段已告警，查询不再重复）。
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveHome } from "../../platform/index.ts";
import { ledgerDir } from "../paths/index.ts";
import { KNOWN_LEDGER_VERSION } from "../types/index.ts";
import type {
  DayAggregate,
  DayTotals,
  LedgerRecord,
  ModelUsage,
  ModelUsageAggregate,
  UsageFilter,
} from "../types/index.ts";

export interface AggregateUsageOptions {
  /** 缺省 resolveHome()（测试注入临时目录）。 */
  readonly home?: string;
}

/** 聚合镜像账本，返回按 day、surface 升序的 DayAggregate 数组。 */
export function aggregateUsage(
  filter: UsageFilter = {},
  options: AggregateUsageOptions = {},
): DayAggregate[] {
  const root = ledgerDir(options.home ?? resolveHome());
  const buckets = new Map<string, DayAggregate>();

  for (const file of listMirrorFiles(root)) {
    let content: string;
    try {
      content = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      if (line === "") continue;
      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      accumulateRecord(record, filter, buckets);
    }
  }

  return [...buckets.values()].sort(
    (a, b) => a.day.localeCompare(b.day) || a.surface.localeCompare(b.surface),
  );
}

/** 镜像目录下的 YYYY-MM-DD.ndjson 文件（按名排序，保证聚合稳定）。 */
function listMirrorFiles(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function accumulateRecord(
  raw: unknown,
  filter: UsageFilter,
  buckets: Map<string, DayAggregate>,
): void {
  if (typeof raw !== "object" || raw === null) return;
  const record = raw as Partial<LedgerRecord>;
  if (typeof record.v !== "number" || record.v !== KNOWN_LEDGER_VERSION) return;
  if (typeof record.ts !== "number" || typeof record.surface !== "string") return;
  if (typeof record.origin !== "string" || typeof record.models !== "object" || record.models === null) {
    return;
  }

  const day = localDayOf(record.ts);
  if (filter.day !== undefined && day !== filter.day) return;
  if (filter.from !== undefined && day < filter.from) return;
  if (filter.to !== undefined && day > filter.to) return;
  if (filter.surface !== undefined && record.surface !== filter.surface) return;
  if (filter.origin !== undefined && record.origin !== filter.origin) return;

  const modelFilter = filter.model;
  const modelNames =
    modelFilter === undefined
      ? Object.keys(record.models)
      : Object.keys(record.models).filter((name) => name === modelFilter);
  if (modelNames.length === 0) return;

  const key = `${day}${record.surface}`;
  const bucket = buckets.get(key);
  const modelsTable = { ...(bucket?.models ?? {}) };
  for (const name of modelNames) {
    modelsTable[name] = addToModel(modelsTable[name], record.models[name]);
  }
  buckets.set(key, {
    day,
    surface: record.surface,
    models: modelsTable,
    totals: addToTotals(bucket?.totals ?? emptyTotals(), record.models, modelNames),
  });
}

/** ts（毫秒 Unix）转本地日期 YYYY-MM-DD，与镜像文件名同格式。 */
function localDayOf(ts: number): string {
  const date = new Date(ts);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

function emptyTotals(): DayTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    calls: 0,
    costUsd: 0,
  };
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function addToTotals(
  totals: DayTotals,
  models: Record<string, ModelUsage>,
  modelNames: string[],
): DayTotals {
  let next = { ...totals, calls: totals.calls + 1 };
  for (const name of modelNames) {
    const usage = models[name];
    next = {
      ...next,
      inputTokens: next.inputTokens + numeric(usage?.inputTokens),
      outputTokens: next.outputTokens + numeric(usage?.outputTokens),
      cacheReadTokens: next.cacheReadTokens + numeric(usage?.cacheReadTokens),
      cacheWriteTokens: next.cacheWriteTokens + numeric(usage?.cacheWriteTokens),
      costUsd: next.costUsd + numeric(usage?.cost?.usd),
    };
  }
  return next;
}

function addToModel(
  aggregate: ModelUsageAggregate | undefined,
  usage: ModelUsage | undefined,
): ModelUsageAggregate {
  const base = aggregate ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    calls: 0,
  };
  return {
    inputTokens: base.inputTokens + numeric(usage?.inputTokens),
    outputTokens: base.outputTokens + numeric(usage?.outputTokens),
    cacheReadTokens: base.cacheReadTokens + numeric(usage?.cacheReadTokens),
    cacheWriteTokens: base.cacheWriteTokens + numeric(usage?.cacheWriteTokens),
    calls: base.calls + 1,
  };
}
