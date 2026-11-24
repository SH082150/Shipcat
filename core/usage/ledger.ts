/**
 * 官方 usage-ledger 读取：从新到旧逐行产出事件。
 *
 * 一行是一个事件（通常是 turn 汇总），文件按天追加；读取时跳过空行、
 * 坏行和非 v=1 的行，尾部半行不读。整个模块只依赖官方账本，不碰任何
 * 明细/调用数据。
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { listOfficialLedgerFiles } from "./paths/index.ts";

export const LEDGER_VERSION = 1;

export interface LedgerEvent {
  /** 事件结束时间，UTC epoch 毫秒。 */
  readonly ts: number;
  /** sha256(rawLine.trim()) 的十六进制串。 */
  readonly hash: string;
  readonly version: number;
  /** chat / cowork / code；只用于按天分面，不进入 cell。 */
  readonly surface: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly webSearchRequests: number;
  /** cost.usd 合计，整数微美元。 */
  readonly costMicroUsd: number;
  /** tools 计数合计，不保留工具名。 */
  readonly toolCalls: number;
}

export interface LedgerScanStats {
  filesRead: number;
  linesRead: number;
  badLines: number;
  partialLines: number;
  unknownVersions: Record<string, number>;
}

export function createScanStats(): LedgerScanStats {
  return {
    filesRead: 0,
    linesRead: 0,
    badLines: 0,
    partialLines: 0,
    unknownVersions: {},
  };
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function sumModels(models: unknown): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearchRequests: number;
  costMicroUsd: number;
} {
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    webSearchRequests: 0,
    costMicroUsd: 0,
  };
  if (models === null || typeof models !== "object" || Array.isArray(models)) return totals;
  for (const usage of Object.values(models as Record<string, unknown>)) {
    if (usage === null || typeof usage !== "object" || Array.isArray(usage)) continue;
    const raw = usage as Record<string, unknown>;
    totals.inputTokens += numeric(raw.inputTokens);
    totals.outputTokens += numeric(raw.outputTokens);
    totals.cacheReadTokens += numeric(raw.cacheReadTokens);
    totals.cacheWriteTokens += numeric(raw.cacheWriteTokens);
    totals.webSearchRequests += numeric(raw.webSearchRequests);
    const cost = raw.cost;
    if (cost !== null && typeof cost === "object" && !Array.isArray(cost)) {
      const usd = (cost as Record<string, unknown>).usd;
      if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) {
        totals.costMicroUsd += Math.round(usd * 1_000_000);
      }
    }
  }
  return totals;
}

function sumTools(tools: unknown): number {
  if (tools === null || typeof tools !== "object" || Array.isArray(tools)) return 0;
  let total = 0;
  for (const value of Object.values(tools as Record<string, unknown>)) {
    total += numeric(value);
  }
  return total;
}

/**
 * 从最新账本文件开始，逐行由新到旧产出事件。
 *
 * `stats` 由调用方持有并累积；生成器本身不抛坏行错误，只有 I/O 失败会抛。
 * 调用方在满足停止条件后 break 即可，不会继续读更旧的文件。
 */
export function* scanLedgerNewestFirst(
  sourceRoot: string,
  stats: LedgerScanStats,
): Generator<LedgerEvent> {
  const files = listOfficialLedgerFiles(sourceRoot).sort((a, b) => b.day.localeCompare(a.day));
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file.absPath, "utf8");
    } catch (error) {
      console.error(`Failed to read usage ledger ${file.absPath}:`, error);
      continue;
    }
    if (content.length === 0) continue;
    stats.filesRead += 1;

    const lines = content.split("\n");
    const last = lines[lines.length - 1];
    if (last === "") {
      lines.pop();
    } else {
      // 正在追加的尾部半行：本轮不读。
      lines.pop();
      if (last !== undefined) stats.partialLines += 1;
    }

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (line === undefined) continue;
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      stats.linesRead += 1;

      let raw: unknown;
      try {
        raw = JSON.parse(trimmed);
      } catch {
        stats.badLines += 1;
        continue;
      }
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        stats.badLines += 1;
        continue;
      }
      const record = raw as Record<string, unknown>;
      const version = record.v;
      if (typeof version !== "number" || !Number.isFinite(version)) {
        stats.badLines += 1;
        continue;
      }
      if (version !== LEDGER_VERSION) {
        const key = String(version);
        stats.unknownVersions[key] = (stats.unknownVersions[key] ?? 0) + 1;
        continue;
      }
      const ts = record.ts;
      if (typeof ts !== "number" || !Number.isFinite(ts)) {
        stats.badLines += 1;
        continue;
      }

      const models = sumModels(record.models);
      yield {
        ts,
        hash: createHash("sha256").update(trimmed).digest("hex"),
        version,
        surface: typeof record.surface === "string" ? record.surface : "",
        ...models,
        toolCalls: sumTools(record.tools),
      };
    }
  }
}
