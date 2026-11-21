/**
 * Usage 模块公共出口：官方 usage-ledger 账本镜像同步 + 聚合查询。
 *
 * 数据源是 Claude-3p 官方按天分文件的 ndjson 账本，字段名与官方 1:1，
 * 不做映射。
 */

export * from "./types/index.ts";
export * as usagePaths from "./paths/index.ts";
export { syncLedger } from "./sync/index.ts";
export type { SyncLedgerOptions } from "./sync/index.ts";
export { aggregateUsage } from "./query/index.ts";
export { aggregateUsageBuckets } from "./query/buckets.ts";
export type {
  UsageBucket,
  UsageBucketDetail,
  UsageBucketRange,
  AggregateBucketOptions,
} from "./query/buckets.ts";
export type { AggregateUsageOptions } from "./query/index.ts";
