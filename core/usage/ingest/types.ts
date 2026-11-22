/**
 * 用量入库内部类型：来源配置、单文件结果与一轮同步摘要。
 */

/** 一个官方账本来源（settings.usage.sources 的元素）。 */
export interface SourceConfig {
  readonly id: string;
  readonly kind: string;
  /** Claude-3p 根或 sessions 根；null = 平台自动探测。 */
  readonly root: string | null;
  readonly enabled: boolean;
}

export type SyncReason = "startup" | "manual" | "watch" | "interval" | "reload";

export type FileAction = "new" | "appended" | "rewritten" | "unchanged" | "skipped";

/** 官方账本里的一个 .ndjson 文件。 */
export interface SourceFile {
  /** 文件名去掉 .ndjson（YYYY-MM-DD）。 */
  readonly day: string;
  readonly absPath: string;
  /** 入库时写入 usage_files.source_path 的绝对路径。 */
  readonly sourcePath: string;
  /** 相对账本根的路径，仅用于告警文案。 */
  readonly sourceRel: string;
}

/** 单行解析出的模型指标。 */
export interface ParsedModelMetric {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly webSearchRequests: number;
}

/** 单行解析出的完整事件。 */
export interface ParsedLedgerEvent {
  /** sha256(rawLine.trim()) 的十六进制串。 */
  readonly fingerprint: string;
  /** 由 ts 转本地日期（YYYY-MM-DD）。 */
  readonly day: string;
  readonly ts: number;
  readonly surface: string;
  readonly origin: string;
  readonly sessionId: string | null;
  readonly models: readonly ParsedModelMetric[];
  /** 官方记录版本；未知版本也照常返回。 */
  readonly version: number;
}

export type ParseLineResult =
  | { readonly kind: "empty" }
  | { readonly kind: "ok"; readonly event: ParsedLedgerEvent }
  | { readonly kind: "bad"; readonly reason: string };

/** 单文件同步结果（service 汇总用）。 */
export interface FileOutcome {
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly day: string;
  readonly action: FileAction;
  readonly linesAdded: number;
  readonly eventsAdded: number;
  readonly eventsReused: number;
  readonly mappingsAdded: number;
  readonly metricsWritten: number;
  readonly warnings: readonly string[];
  readonly unknownVersions: Readonly<Record<string, number>>;
}

/** 一轮 syncNow 的摘要。 */
export interface SyncSummary {
  readonly reason: SyncReason;
  readonly revision: number;
  readonly filesScanned: number;
  readonly filesNew: number;
  readonly filesAppended: number;
  readonly filesRewritten: number;
  readonly filesUnchanged: number;
  readonly filesSkipped: number;
  readonly linesAdded: number;
  readonly eventsAdded: number;
  readonly eventsReused: number;
  readonly mappingsAdded: number;
  readonly metricsWritten: number;
  readonly warnings: readonly string[];
  readonly unknownVersionsSeen: Readonly<Record<string, number>>;
  readonly lastSyncAt: string;
}
