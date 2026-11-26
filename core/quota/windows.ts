/**
 * 滚动窗口统计：5 小时 / 7 天 / 30 天各算各的，互不影响。
 *
 * 与 CC-Switch 的做法一样，窗口只是对记录 ts 的时间过滤：不设锚点、
 * 不做增量状态，起点永远是查询时刻减窗口长度，因此也没有「重置」概念。
 */

export type QuotaWindowKind = "5h" | "7d" | "30d";

export interface QuotaWindowDefinition {
  readonly kind: QuotaWindowKind;
  readonly durationMs: number;
}

export const QUOTA_WINDOWS: readonly QuotaWindowDefinition[] = [
  { kind: "5h", durationMs: 5 * 3_600_000 },
  { kind: "7d", durationMs: 7 * 86_400_000 },
  { kind: "30d", durationMs: 30 * 86_400_000 },
];

interface QuotaTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export interface QuotaRecordLike {
  readonly ts: number;
  readonly provider: Readonly<
    Record<string, Readonly<Record<string, QuotaTokenUsage>>>
  >;
}

export interface QuotaWindowSummary {
  readonly kind: QuotaWindowKind;
  /** 窗口起点（含），now - durationMs。 */
  readonly start: number;
  /** 窗口终点（含），即查询时刻。 */
  readonly end: number;
  readonly records: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly totalTokens: number;
  /** cacheRead / (input + cacheRead + cacheWrite)；分母为 0 时为 null。 */
  readonly cacheHitRate: number | null;
  /** (input + cacheRead + cacheWrite) / totalTokens；分母为 0 时为 null。 */
  readonly inputShare: number | null;
  /** output / totalTokens；分母为 0 时为 null。 */
  readonly outputShare: number | null;
}

export interface QuotaOptions {
  readonly now: number;
  /** null / 省略 = 全部供应商（含 unknown）；数组 = 只统计这些 key。 */
  readonly providers?: readonly string[] | null;
}

interface MutableTotals {
  records: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

function emptyTotals(): MutableTotals {
  return {
    records: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export interface QuotaRange {
  readonly start: number;
  readonly end: number;
}

/** 任意区间（含边界）的本地用量；供按供应商重置窗口聚合使用。 */
export function sumQuotaRange(
  records: readonly QuotaRecordLike[],
  range: QuotaRange,
  providers: readonly string[] | null = null,
): Omit<QuotaWindowSummary, "kind" | "start" | "end"> & { readonly start: number; readonly end: number } {
  const allowed = providers === null ? null : new Set(providers);
  const total = emptyTotals();
  for (const record of records) {
    if (record.ts < range.start || record.ts > range.end) continue;
    let matched = false;
    for (const [providerId, models] of Object.entries(record.provider)) {
      if (allowed !== null && !allowed.has(providerId)) continue;
      matched = true;
      for (const usage of Object.values(models)) {
        total.inputTokens += usage.inputTokens;
        total.outputTokens += usage.outputTokens;
        total.cacheReadTokens += usage.cacheReadTokens;
        total.cacheWriteTokens += usage.cacheWriteTokens;
        total.totalTokens +=
          usage.inputTokens +
          usage.outputTokens +
          usage.cacheReadTokens +
          usage.cacheWriteTokens;
      }
    }
    if (matched) total.records += 1;
  }
  const cacheable = total.inputTokens + total.cacheReadTokens + total.cacheWriteTokens;
  return {
    start: range.start,
    end: range.end,
    records: total.records,
    inputTokens: total.inputTokens,
    outputTokens: total.outputTokens,
    cacheReadTokens: total.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens,
    totalTokens: total.totalTokens,
    cacheHitRate: ratio(total.cacheReadTokens, cacheable),
    inputShare: ratio(cacheable, total.totalTokens),
    outputShare: ratio(total.outputTokens, total.totalTokens),
  };
}

/** 逐条记录按窗口起点过滤；同一条记录出现多个供应商时只累加被选中的 key。 */
export function sumQuotaWindows(
  records: readonly QuotaRecordLike[],
  options: QuotaOptions,
): QuotaWindowSummary[] {
  const { now } = options;
  const allowed =
    options.providers === null || options.providers === undefined
      ? null
      : new Set(options.providers);
  const totals = QUOTA_WINDOWS.map(() => emptyTotals());

  for (const record of records) {
    if (record.ts > now) continue;
    for (let index = 0; index < QUOTA_WINDOWS.length; index += 1) {
      const window = QUOTA_WINDOWS[index];
      const total = totals[index];
      if (window === undefined || total === undefined) continue;
      if (record.ts < now - window.durationMs) continue;

      let matched = false;
      for (const [providerId, models] of Object.entries(record.provider)) {
        if (allowed !== null && !allowed.has(providerId)) continue;
        matched = true;
        for (const usage of Object.values(models)) {
          total.inputTokens += usage.inputTokens;
          total.outputTokens += usage.outputTokens;
          total.cacheReadTokens += usage.cacheReadTokens;
          total.cacheWriteTokens += usage.cacheWriteTokens;
          total.totalTokens +=
            usage.inputTokens +
            usage.outputTokens +
            usage.cacheReadTokens +
            usage.cacheWriteTokens;
        }
      }
      if (matched) total.records += 1;
    }
  }

  return QUOTA_WINDOWS.map((window, index) => {
    const total = totals[index] ?? emptyTotals();
    const cacheable = total.inputTokens + total.cacheReadTokens + total.cacheWriteTokens;
    return {
      kind: window.kind,
      start: now - window.durationMs,
      end: now,
      records: total.records,
      inputTokens: total.inputTokens,
      outputTokens: total.outputTokens,
      cacheReadTokens: total.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens,
      totalTokens: total.totalTokens,
      cacheHitRate: ratio(total.cacheReadTokens, cacheable),
      inputShare: ratio(cacheable, total.totalTokens),
      outputShare: ratio(total.outputTokens, total.totalTokens),
    };
  });
}
