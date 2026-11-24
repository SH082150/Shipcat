/**
 * Layer 2 结构：每个粒度一个 `cells.json`，336 个槽位。
 */

export interface Layer2Total {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly toolCalls: number;
  readonly webSearchRequests: number;
}

export interface Layer2Snapshot {
  /** 本次构建完成时间，UTC epoch 毫秒。 */
  readonly lastSyncAt: number;
  /** 按 config.timezone 生成的展示时间 YYYY-MM-DD HH:mm:ss。 */
  readonly lastSyncDisplay: string;
  readonly total: Layer2Total;
  /** 336 个桶起点，索引 0 = 最新。 */
  readonly ts: readonly number[];
  readonly display: readonly string[];
  readonly level: readonly number[];
}

export interface UsageBucketDetailDto {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly calls: number;
  readonly webSearchRequests: number;
}

export interface UsageBucketDto {
  readonly start: string;
  readonly end: string;
  readonly value: number;
  readonly level: 0 | 1 | 2 | 3 | 4;
  readonly label: string;
  readonly detail: UsageBucketDetailDto;
}

export interface UsageDailyPointDto {
  readonly day: string;
  readonly chat: number;
  readonly cowork: number;
  readonly code: number;
}

export interface UsageViewDto {
  readonly revision: number;
  readonly lastSyncedAt: string | null;
  /** 已按 config.timezone 格式化；UI 只显示日期部分。 */
  readonly lastSyncDisplay?: string | null;
  readonly heatmap: readonly UsageBucketDto[];
  readonly daily: readonly UsageDailyPointDto[];
  readonly warnings: readonly string[];
}

export interface UsageViewQuery {
  readonly heatmapRange: "30min" | "1h" | "1d";
  readonly dailyDays: 7 | 30 | 90;
}
