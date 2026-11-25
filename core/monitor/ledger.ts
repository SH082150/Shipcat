/**
 * Monitor 官方账本读取：保留 origin/sessionId/isError、模型键和工具分布。
 *
 * usage 的聚合读取器会在解析时丢掉这些字段，因此 Monitor 使用独立解析器；
 * 两边只共享官方文件枚举，不共享游标或运行状态。
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { listOfficialLedgerFiles } from "../usage/paths/index.ts";
import { OFFICIAL_LEDGER_VERSION } from "./types.ts";
import type { MonitorScanStats, MonitorTokenUsage } from "./types.ts";

export interface OfficialMonitorEntry {
  readonly sourceTs: number;
  readonly sourceRel: string;
  /** 1 起的物理行号；空行、坏行同样占号。 */
  readonly lineNo: number;
  readonly rawLine: string;
  readonly surface: string;
  readonly origin: string;
  readonly sessionId: string | null;
  readonly isError: boolean;
  readonly models: Readonly<Record<string, MonitorTokenUsage>>;
  readonly tools: Record<string, number>;
}

export function createMonitorScanStats(): MonitorScanStats {
  return {
    filesRead: 0,
    linesRead: 0,
    recordsProcessed: 0,
    badLines: 0,
    partialLines: 0,
    unknownVersions: {},
  };
}

export function monitorLineHash(rawLine: string): string {
  return createHash("sha256").update(rawLine.trim()).digest("hex");
}

function numeric(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function tokenUsage(value: unknown): MonitorTokenUsage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearchRequests: 0,
    };
  }
  const raw = value as Record<string, unknown>;
  return {
    inputTokens: numeric(raw.inputTokens),
    outputTokens: numeric(raw.outputTokens),
    cacheReadTokens: numeric(raw.cacheReadTokens),
    cacheWriteTokens: numeric(raw.cacheWriteTokens),
    webSearchRequests: numeric(raw.webSearchRequests),
  };
}

function parseModels(value: unknown): Record<string, MonitorTokenUsage> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const models: Record<string, MonitorTokenUsage> = {};
  for (const [model, usage] of Object.entries(value as Record<string, unknown>)) {
    models[model] = tokenUsage(usage);
  }
  return models;
}

function parseTools(value: unknown): Record<string, number> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const tools: Record<string, number> = {};
  for (const [name, count] of Object.entries(value as Record<string, unknown>)) {
    tools[name] = numeric(count);
  }
  return tools;
}

/** 从最新官方文件开始，按行从新到旧产出完整记录。 */
export function* scanMonitorLedger(
  sourceRoot: string,
  stats: MonitorScanStats,
): Generator<OfficialMonitorEntry> {
  const files = listOfficialLedgerFiles(sourceRoot).sort((a, b) =>
    b.day.localeCompare(a.day),
  );
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file.absPath, "utf8");
    } catch (error) {
      console.error(`Failed to read monitor ledger ${file.absPath}:`, error);
      continue;
    }
    if (content.length === 0) continue;
    stats.filesRead += 1;

    const lines = content.split("\n");
    const last = lines[lines.length - 1];
    if (last === "") {
      lines.pop();
    } else {
      lines.pop();
      if (last !== undefined) stats.partialLines += 1;
    }

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (line === undefined) continue;
      const rawLine = line.trim();
      if (rawLine.length === 0) continue;
      stats.linesRead += 1;

      let raw: unknown;
      try {
        raw = JSON.parse(rawLine);
      } catch {
        stats.badLines += 1;
        continue;
      }
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        stats.badLines += 1;
        continue;
      }
      const record = raw as Record<string, unknown>;
      if (typeof record.v !== "number" || !Number.isFinite(record.v)) {
        stats.badLines += 1;
        continue;
      }
      if (record.v !== OFFICIAL_LEDGER_VERSION) {
        const key = String(record.v);
        stats.unknownVersions[key] = (stats.unknownVersions[key] ?? 0) + 1;
        continue;
      }
      // Date 可表示范围是 ±8.64e15；越界或负值无法按日分片，按坏行跳过。
      if (
        typeof record.ts !== "number" ||
        !Number.isFinite(record.ts) ||
        record.ts < 0 ||
        record.ts > 8_640_000_000_000_000
      ) {
        stats.badLines += 1;
        continue;
      }

      yield {
        sourceTs: record.ts,
        sourceRel: file.sourceRel,
        lineNo: index + 1,
        rawLine,
        surface: typeof record.surface === "string" ? record.surface : "",
        origin: typeof record.origin === "string" ? record.origin : "",
        sessionId: typeof record.sessionId === "string" ? record.sessionId : null,
        isError: record.isError === true,
        models: parseModels(record.models),
        tools: parseTools(record.tools),
      };
    }
  }
}
