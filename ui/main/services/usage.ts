import * as core from "../../../core/index.ts";
import type { UsageAggregateRow, UsageData, UsageFilter } from "../../shared/ipc.ts";
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
