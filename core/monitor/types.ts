/**
 * Monitor 领域类型：官方记录级明细、固定偏移配置与同步结果。
 */

/** 官方 usage-ledger 的行版本。 */
export const OFFICIAL_LEDGER_VERSION = 1;
/** Monitor 自建日文件 / 游标的格式版本；v2 起 ts 为原始 UTC。 */
export const MONITOR_LEDGER_VERSION = 2;
export const UNKNOWN_PROVIDER = "unknown";
export const UNKNOWN_MODEL = "unknown";

export interface MonitorTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly webSearchRequests: number;
}

export type MonitorProviderUsage = Record<
  string,
  Record<string, MonitorTokenUsage>
>;

export interface MonitorRecord {
  readonly v: number;
  /** 记录级稳定标识（与通知事件 eventId 一致）。旧文件缺失时由内容推导。 */
  readonly id?: string;
  /** 官方原始 UTC ts；展示时按 usage 配置的时区格式化。 */
  readonly ts: number;
  readonly surface: string;
  readonly origin: string;
  readonly sessionId: string | null;
  readonly isError: boolean;
  readonly provider: MonitorProviderUsage;
  readonly tools: Record<string, number>;
}

/** 通知层事件：Layer 1 记录 + 来源定位与原始行。不写入日文件。 */
export interface MonitorRecordEvent extends MonitorRecord {
  /** 记录级去重键：sourceRel + 行号 + 原始行。 */
  readonly eventId: string;
  /** 官方原始 UTC 时间（游标口径）。 */
  readonly sourceTs: number;
  readonly sourceRel: string;
  readonly lineNo: number;
  readonly rawLine: string;
}

export interface MonitorMeta {
  readonly v: number;
  /** 最后成功处理的官方原始 UTC ts。 */
  readonly ts: number;
  /** 最后成功处理官方原始行的 sha256。 */
  readonly hash: string;
  /** 写入时使用的 IANA 时区；与当前 usage 配置不一致时整库重建。 */
  readonly timezone: string;
  /** 写入时的账本根；来源切换后必须重建，不能沿用旧游标。 */
  readonly source: string;
}

export interface MonitorScanStats {
  filesRead: number;
  linesRead: number;
  recordsProcessed: number;
  badLines: number;
  partialLines: number;
  unknownVersions: Record<string, number>;
}

export type MonitorSyncReason =
  | "startup"
  | "watch"
  | "fallback"
  | "pending"
  | "manual";

export interface MonitorSyncSummary extends MonitorScanStats {
  readonly reason: MonitorSyncReason | "rebuild";
  readonly rebuilt: boolean;
  readonly lastSyncAt: number;
  readonly warnings: readonly string[];
}
