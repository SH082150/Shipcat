/**
 * 额度显示视图：把脚本返回的窗口与本地 Layer 2 聚合拼在一起。
 *
 * 脚本给出每个窗口的 resetAt；Layer 2 的区间固定为
 * `[resetAt - 周期, resetAt]`，周期由窗口 key（5h / 7d / 30d）决定。
 * 没有 resetAt 的窗口只展示远端读数，不生成 Layer 2。
 */

import { sumQuotaRange } from "./windows.ts";
import type { QuotaRange, QuotaRecordLike } from "./windows.ts";
import type {
  QuotaBalanceReading,
  QuotaQueryOutcome,
  QuotaWindowKey,
  QuotaWindowReading,
} from "./script/types.ts";

export const QUOTA_WINDOW_PERIOD_MS: Readonly<Record<QuotaWindowKey, number>> = {
  "5h": 5 * 3_600_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

export const QUOTA_WINDOW_ORDER: readonly QuotaWindowKey[] = ["5h", "7d", "30d"];

export interface LimitLocalUsage {
  readonly records: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly totalTokens: number;
  readonly cacheHitRate: number | null;
  readonly inputShare: number | null;
  readonly outputShare: number | null;
}

export interface LimitWindowView {
  readonly key: QuotaWindowKey;
  /** Layer 2 区间；没有 resetAt 时为 null。 */
  readonly range: QuotaRange | null;
  readonly remote: QuotaWindowReading;
  readonly local: LimitLocalUsage | null;
}

export interface LimitView {
  readonly profileId: string;
  readonly providerId: string;
  readonly fetchedAt: number;
  readonly ok: boolean;
  readonly windows: readonly LimitWindowView[];
  readonly balance?: QuotaBalanceReading;
  readonly error?: string;
  /** 本地记录达到读取上限，窗口用量可能偏小。 */
  readonly truncated?: boolean;
}

export interface BuildLimitViewInput {
  readonly profileId: string;
  readonly providerId: string;
  readonly outcome: QuotaQueryOutcome;
  readonly records: readonly QuotaRecordLike[];
  readonly truncated?: boolean;
}

function localOf(
  records: readonly QuotaRecordLike[],
  range: QuotaRange,
  providerId: string,
): LimitLocalUsage {
  const totals = sumQuotaRange(records, range, [providerId]);
  return {
    records: totals.records,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    totalTokens: totals.totalTokens,
    cacheHitRate: totals.cacheHitRate,
    inputShare: totals.inputShare,
    outputShare: totals.outputShare,
  };
}

/** 按脚本输出组装视图；窗口只保留脚本实际返回的 key。 */
export function buildLimitView(input: BuildLimitViewInput): LimitView {
  const { outcome } = input;
  if (!outcome.ok || outcome.result === undefined) {
    return {
      profileId: input.profileId,
      providerId: input.providerId,
      fetchedAt: outcome.fetchedAt,
      ok: false,
      windows: [],
      ...(outcome.error === undefined ? {} : { error: outcome.error }),
    };
  }

  const windows: LimitWindowView[] = [];
  for (const key of QUOTA_WINDOW_ORDER) {
    const remote = outcome.result.windows?.[key];
    if (remote === undefined) continue;
    const resetAt = remote.resetAt;
    const range: QuotaRange | null =
      resetAt === undefined
        ? null
        : { start: resetAt - QUOTA_WINDOW_PERIOD_MS[key], end: resetAt };
    windows.push({
      key,
      range,
      remote,
      local: range === null ? null : localOf(input.records, range, input.providerId),
    });
  }

  return {
    profileId: input.profileId,
    providerId: input.providerId,
    fetchedAt: outcome.fetchedAt,
    ok: true,
    windows,
    ...(outcome.result.balance === undefined ? {} : { balance: outcome.result.balance }),
    ...(input.truncated === true ? { truncated: true } : {}),
  };
}
