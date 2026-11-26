/** 额度窗口统计：5 小时 / 7 天 / 30 天三个独立滚动窗口。 */

export { QUOTA_WINDOWS, sumQuotaWindows } from "./windows.ts";
export type {
  QuotaOptions,
  QuotaRecordLike,
  QuotaWindowDefinition,
  QuotaWindowKind,
  QuotaWindowSummary,
} from "./windows.ts";
export { QUOTA_RECORD_LIMIT, queryQuotaWindows } from "./query.ts";
export type { QuotaQueryOptions, QuotaSnapshot } from "./query.ts";
export {
  QUOTA_WINDOW_ORDER,
  QUOTA_WINDOW_PERIOD_MS,
  buildLimitView,
} from "./limit.ts";
export type {
  BuildLimitViewInput,
  LimitLocalUsage,
  LimitView,
  LimitWindowView,
} from "./limit.ts";
export { sumQuotaRange } from "./windows.ts";
export type { QuotaRange } from "./windows.ts";
export * as script from "./script/index.ts";
