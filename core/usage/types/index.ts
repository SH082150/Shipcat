/**
 * Usage 模块共享类型与常量。字段名与官方 usage-ledger 账本 1:1 对应，
 * 不做任何映射或重命名；未知字段一律忽略。
 */

/** 已知的官方账本记录版本，目前为 1。 */
export const KNOWN_LEDGER_VERSION = 1;

/** 官方估价：美元金额 + 计价基准（list 官方标价 / managed 托管价）。 */
export interface Cost {
  readonly usd: number;
  readonly basis: "list" | "managed" | string;
}

/** 账本行内单个模型的用量条目（字段名与官方一致）。 */
export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly webSearchRequests: number;
  /** 后期版本才有，旧行可能缺失。 */
  readonly cacheWrite5mTokens?: number;
  /** 后期版本才有，旧行可能缺失。 */
  readonly cacheWrite1hTokens?: number;
  /** Desktop 不认识的模型（如网关别名）无此字段。 */
  readonly cost?: Cost;
}

/** 账本行：一次 API 调用的完整记录。 */
export interface LedgerRecord {
  readonly v: number;
  /** 毫秒 Unix 时间戳，决定记录归属哪一天。 */
  readonly ts: number;
  /** 界面：chat / code / cowork。 */
  readonly surface: string;
  /** 调用原因：turn / title / connection_probe 等。 */
  readonly origin: string;
  readonly sessionId?: string;
  readonly isError: boolean;
  /** 键 = 模型名（Desktop 内部命名）；一行可有多个模型键。 */
  readonly models: Record<string, ModelUsage>;
  /** 工具调用计数，仅 turn 且实际调用工具时有。 */
  readonly tools?: Record<string, number>;
}

/** 单个镜像文件的同步游标（存于 _meta.json 的 files 表）。 */
export interface LedgerFileCursor {
  /** 镜像内容末尾对应的官方文件字节偏移（最后一个完整行之后）。 */
  readonly byteOffset: number;
  /** 游标建立时官方文件的总字节数（含可能存在的尾部半行）。 */
  readonly size: number;
  readonly mtimeMs: number;
  readonly lastSyncedAt: string;
  /** 该镜像经历过的整文件重写次数。 */
  readonly rewriteCount: number;
  /** 来源相对官方账本根的路径（<账号>/<子层>/usage-ledger/<day>.ndjson）。 */
  readonly source: string;
  /**
   * 官方文件 [max(0, byteOffset-4096), byteOffset) 区间的 sha256 指纹，
   * 用于检测非追加改写；旧 meta 无此字段时视为不可校验，触发重写。
   */
  readonly tailHash?: string;
}

/** _meta.json：整个镜像目录的同步状态。 */
export interface UsageMeta {
  readonly schemaVersion: number;
  readonly lastSyncAt: string;
  readonly sourceRoot: string;
  /** key = 日期文件名 YYYY-MM-DD.ndjson。 */
  readonly files: Record<string, LedgerFileCursor>;
  /** 累计见过的账本版本 → 行数。 */
  readonly ledgerVersionsSeen: Record<string, number>;
  /** 最近一次同步产生的告警（多来源冲突、坏行、未知版本等）。 */
  readonly warnings: string[];
}

/** syncLedger 的返回：本轮同步摘要。 */
export interface SyncResult {
  /** 枚举到的官方账本文件总数（含冲突跳过）。 */
  readonly filesScanned: number;
  /** 本轮全新复制的文件数。 */
  readonly filesNew: number;
  /** 本轮增量追加的文件数（源有新字节才计；无变化不计）。 */
  readonly filesAppended: number;
  /** 本轮整文件重写的文件数。 */
  readonly filesRewritten: number;
  /** 因多来源冲突等原因跳过的文件数。 */
  readonly filesSkipped: number;
  /** 本轮镜像新增的完整行数。 */
  readonly linesAdded: number;
  readonly warnings: string[];
  /** 本轮见到的未知账本版本（≠ KNOWN_LEDGER_VERSION）→ 行数。 */
  readonly unknownVersionsSeen: Record<string, number>;
  /** 本轮同步完成时间 ISO8601。 */
  readonly lastSyncAt: string;
}

/** aggregateUsage 的过滤条件：全部可选，精确匹配。 */
export interface UsageFilter {
  /** 精确日期 YYYY-MM-DD。 */
  readonly day?: string;
  /** 起始日期（含），YYYY-MM-DD。 */
  readonly from?: string;
  /** 结束日期（含），YYYY-MM-DD。 */
  readonly to?: string;
  readonly surface?: string;
  readonly origin?: string;
  /** 只统计含该模型键的记录，且聚合只算该模型。 */
  readonly model?: string;
}

/** 单模型（或合计）的累加用量。 */
export interface ModelUsageAggregate {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  /** 计入该聚合的记录行数。 */
  readonly calls: number;
}

/** (天, 界面) 维度的合计，额外带成本。 */
export interface DayTotals extends ModelUsageAggregate {
  /** 累加 cost?.usd ?? 0；无 cost 字段的记录贡献 0，不报错。 */
  readonly costUsd: number;
}

/** 聚合结果单元：一天 × 一个 surface。 */
export interface DayAggregate {
  readonly day: string;
  readonly surface: string;
  /** 键 = 模型名；calls = 含该模型的行数。 */
  readonly models: Record<string, ModelUsageAggregate>;
  /** 全部模型键全量累加的合计。 */
  readonly totals: DayTotals;
}
