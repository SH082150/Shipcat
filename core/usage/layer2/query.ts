/**
 * Layer 2 读取：cells.json 只提供槽位/等级/展示时间，卡片明细按 `ts[i]`
 * 回 Layer 1 取单格。UI 不参与聚合。
 */

import { existsSync, readFileSync } from "node:fs";

import { addLocalDays, formatBucketStart, LEVEL_STEP_MS } from "../time.ts";
import type { Layer1Level } from "../time.ts";
import { readCellAt, readTpdWindow } from "../layer1/query.ts";
import { layer2File } from "../layer1/paths.ts";
import { cellValue, emptyCell } from "../layer1/types.ts";
import type {
  Layer2Snapshot,
  UsageBucketDto,
  UsageViewDto,
  UsageViewQuery,
} from "./types.ts";

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const out: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item)) return null;
    out.push(item);
  }
  return out;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    out.push(item);
  }
  return out;
}

/** 读取已构建的 Layer 2；缺失或结构损坏返回 null（下次同步重建）。 */
export function readLayer2(root: string, level: Layer1Level): Layer2Snapshot | null {
  const file = layer2File(root, level);
  if (!existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const ts = numberArray(record.ts);
  const display = stringArray(record.display);
  const levelValues = numberArray(record.level);
  if (ts === null || display === null || levelValues === null) return null;
  if (ts.length !== display.length || ts.length !== levelValues.length) return null;
  const totalRaw = record.total;
  if (totalRaw === null || typeof totalRaw !== "object" || Array.isArray(totalRaw)) return null;
  const total = totalRaw as Record<string, unknown>;
  return {
    lastSyncAt: numberValue(record.lastSyncAt),
    lastSyncDisplay: typeof record.lastSyncDisplay === "string" ? record.lastSyncDisplay : "",
    total: {
      inputTokens: numberValue(total.inputTokens),
      outputTokens: numberValue(total.outputTokens),
      cacheReadTokens: numberValue(total.cacheReadTokens),
      cacheWriteTokens: numberValue(total.cacheWriteTokens),
      toolCalls: numberValue(total.toolCalls),
      webSearchRequests: numberValue(total.webSearchRequests),
    },
    ts,
    display,
    level: levelValues,
  };
}

export function levelOfRange(range: UsageViewQuery["heatmapRange"]): Layer1Level {
  return range === "30min" ? "30m" : range;
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

function normalizeLevel(value: number): 0 | 1 | 2 | 3 | 4 {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  if (rounded < 1) return 0;
  if (rounded > 4) return 4;
  return rounded as 1 | 2 | 3 | 4;
}

function bucketEnd(ts: number, level: Layer1Level, timezone: string): number {
  return level === "1d" ? addLocalDays(ts, 1, timezone) : ts + LEVEL_STEP_MS[level];
}

export interface BuildUsageViewOptions {
  readonly root: string;
  readonly timezone: string;
  readonly now: number;
  /** 由 UsageService 维护的递增版本号。 */
  readonly revision: number;
  readonly query: UsageViewQuery;
}

/** 生成 UI 视图：热力图按槽位，按天图读 tpd。 */
export function buildUsageView(options: BuildUsageViewOptions): UsageViewDto {
  const { root, timezone, now, revision } = options;
  const query = normalizeQuery(options.query);
  const level = levelOfRange(query.heatmapRange);
  const snapshot = readLayer2(root, level);

  const heatmap: UsageBucketDto[] =
    snapshot === null
      ? []
      : snapshot.ts.map((ts, index) => {
          const cell = readCellAt(root, level, ts) ?? emptyCell();
          const value = cellValue(cell);
          return {
            start: new Date(ts).toISOString(),
            end: new Date(bucketEnd(ts, level, timezone)).toISOString(),
            value,
            level: normalizeLevel(snapshot.level[index] ?? 0),
            label: snapshot.display[index] ?? formatBucketStart(ts, level, timezone),
            detail: {
              inputTokens: cell.inputTokens,
              outputTokens: cell.outputTokens,
              cacheReadTokens: cell.cacheReadTokens,
              cacheWriteTokens: cell.cacheWriteTokens,
              calls: cell.toolCalls,
              webSearchRequests: cell.webSearchRequests,
            },
          };
        });

  const daily = readTpdWindow(root, query.dailyDays, timezone, now).map((point) => ({
    day: point.day,
    chat: point.cell.chat,
    cowork: point.cell.cowork,
    code: point.cell.code,
  }));

  return {
    revision,
    lastSyncedAt:
      snapshot === null || snapshot.lastSyncAt <= 0
        ? null
        : new Date(snapshot.lastSyncAt).toISOString(),
    lastSyncDisplay: snapshot?.lastSyncDisplay ?? null,
    heatmap,
    daily,
    warnings: [],
  };
}
