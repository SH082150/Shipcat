import * as core from "../../../core/index.ts";
import type { UsageIngestService } from "../../../core/usage/ingest/service.ts";
import type { SyncSummary } from "../../../core/usage/ingest/types.ts";
import type { UsageAggregateRow, UsageData, UsageFilter, UsageViewDto, UsageViewQuery } from "../../shared/ipc.ts";
import type { ServiceOptions } from "./providers.ts";

function opts(options: ServiceOptions): { home?: string } | undefined {
  return options.home === undefined ? undefined : { home: options.home };
}

export function syncUsage(options: ServiceOptions = {}): UsageData["sync"] {
  const result = core.usage.syncLedger(opts(options) ?? {});
  return {
    filesNew: result.filesNew,
    filesAppended: result.filesAppended,
    filesRewritten: result.filesRewritten,
    linesAdded: result.linesAdded,
    lastSyncAt: result.lastSyncAt,
    warnings: result.warnings,
  };
}

export function aggregateUsage(filter: UsageFilter = {}, options: ServiceOptions = {}): UsageAggregateRow[] {
  const rows = core.usage.aggregateUsage(
    {
      ...(filter.day === undefined ? {} : { day: filter.day }),
      ...(filter.from === undefined ? {} : { from: filter.from }),
      ...(filter.to === undefined ? {} : { to: filter.to }),
      ...(filter.surface === undefined ? {} : { surface: filter.surface }),
      ...(filter.origin === undefined ? {} : { origin: filter.origin }),
      ...(filter.model === undefined ? {} : { model: filter.model }),
    },
    opts(options) ?? {},
  );
  return rows.map((row) => ({
    day: row.day,
    surface: row.surface,
    totals: {
      inputTokens: row.totals.inputTokens,
      outputTokens: row.totals.outputTokens,
      cacheReadTokens: row.totals.cacheReadTokens,
      cacheWriteTokens: row.totals.cacheWriteTokens,
      calls: row.totals.calls,
      costUsd: row.totals.costUsd,
    },
  }));
}

export function loadUsageBuckets(range: "30min" | "1h" | "1d", options: ServiceOptions = {}) {
  return core.usage.aggregateUsageBuckets(range, opts(options) ?? {});
}

/**
 * 新版查询入口：从入库服务持有的 SQLite 只读查询。
 * query 缺省/非法时由 core 查询层回落到 30min / 30 天。
 */
export function getUsageView(
  service: UsageIngestService,
  query?: UsageViewQuery | null,
): UsageViewDto {
  const safe: UsageViewQuery = query ?? { heatmapRange: "30min", dailyDays: 30 };
  return service.withDatabase((db) => core.queries.getUsageView(db, safe));
}

/** 手动触发一次入库同步；返回本轮同步摘要。 */
export function refreshUsage(service: UsageIngestService): Promise<SyncSummary> {
  return service.syncNow("manual");
}
