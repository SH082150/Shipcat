/**
 * Electron 主进程 ↔ 渲染层契约。
 *
 * 只放 UI-facing DTO、channel 名和结果信封；不 import core，也不含 Node 依赖。
 * 主进程负责把 core 形状映射成这些 DTO，渲染层只认这里。
 */

export interface AppError {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export type AppResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AppError };

export type ProviderAuthScheme = "x-api-key" | "bearer";

export interface ProviderSummary {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly scheme: ProviderAuthScheme;
}

export interface ProviderDetail extends ProviderSummary {
  readonly apiKey: string;
}

export interface ProviderInput {
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly scheme: ProviderAuthScheme;
}

export interface ProviderPatch {
  readonly name?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly scheme?: ProviderAuthScheme;
}

export type ProfileMode = "standard" | "advanced" | "readOnly";
export type GatewayAuthScheme = "x-api-key" | "bearer";

export interface ModelEntry {
  readonly name: string;
  readonly labelOverride?: string;
  readonly supports1m?: boolean;
  readonly prefer1m?: boolean;
  readonly anthropicFamilyTier?: string;
  readonly isFamilyDefault?: boolean;
  readonly behavesAs?: string;
  readonly maxEffort?: string;
  /** 供应商 UUID（readOnly 为空）。 */
  readonly provider?: string;
  /** 供应商显示名（由主进程 join 索引得到）。 */
  readonly providerName?: string;
  readonly upstreamModel?: string;
}

export interface ModelInput {
  readonly name: string;
  readonly labelOverride?: string;
  readonly supports1m?: boolean;
  readonly prefer1m?: boolean;
  readonly anthropicFamilyTier?: string;
  readonly isFamilyDefault?: boolean;
  readonly behavesAs?: string;
  readonly maxEffort?: string;
  readonly provider?: string;
  readonly upstreamModel?: string;
}

export interface ProfileSummary {
  readonly id: string;
  readonly name: string;
  readonly mode: ProfileMode;
  readonly applied: boolean;
  readonly modelCount: number;
  readonly port?: number;
}

export interface ProfileDetail extends ProfileSummary {
  readonly gatewayToken?: string;
  readonly gatewayAuthScheme?: GatewayAuthScheme;
  readonly models: readonly ModelEntry[];
  readonly claude?: Record<string, unknown>;
}

export interface ProfileCreateInput {
  readonly name: string;
  readonly mode: "standard" | "advanced";
  readonly port?: number;
  readonly gatewayToken?: string;
  readonly gatewayAuthScheme?: GatewayAuthScheme;
  readonly models: readonly ModelInput[];
  readonly claude?: Record<string, unknown>;
}

export interface ProfileUpdateInput {
  readonly name?: string;
  readonly port?: number;
  readonly gatewayToken?: string;
  readonly gatewayAuthScheme?: GatewayAuthScheme;
  readonly claude?: Record<string, unknown> | null;
}

export interface GatewayStatus {
  readonly running: boolean;
  readonly profileId?: string;
  readonly port?: number;
  readonly error?: string;
}

export interface OverviewData {
  readonly activeProfile: ProfileSummary | null;
  readonly gateway: GatewayStatus;
}

export interface StatusProfile extends ProfileSummary {
  readonly modelCount: number;
}

export interface StatusData {
  readonly appliedId: string | null;
  readonly claudeAppliedId: string | null;
  readonly profiles: readonly StatusProfile[];
  readonly providers: readonly ProviderSummary[];
}

/** 文件库同步频率：只能取这几档，和 ClockService 的对齐边界一致。 */
export type UsageSyncInterval = 1 | 5 | 10 | 15 | 30;

export interface UsageConfigDto {
  readonly timezone: string;
  readonly syncIntervalMinutes: UsageSyncInterval;
}

/** 一轮同步的结果摘要；不是统计数据本身。 */
export interface UsageSyncResultDto {
  readonly reason: "startup" | "manual" | "clock" | "reload";
  readonly skipped: boolean;
  readonly lastSyncAt: number;
  readonly rebuiltLevels: readonly string[];
  readonly eventsProcessed: number;
  readonly filesRead: number;
  readonly badLines: number;
  readonly partialLines: number;
  readonly unknownVersions: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
}

/** 新查询层：与 core/queries/usage.ts 的结构保持一致。 */
export interface UsageViewQuery {
  readonly heatmapRange: "30min" | "1h" | "1d";
  readonly dailyDays: 7 | 30 | 90;
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

export interface UsageChangedEvent {
  readonly revision: number;
}

/** 用量采集来源（设置页「用量」章节使用）。 */
export interface UsageSourceDto {
  readonly id: string;
  readonly kind: string;
  /** 用户指定路径；null 表示自动探测。 */
  readonly root: string | null;
  /** 解析后的实际账本根，仅在主进程计算。 */
  readonly resolvedRoot: string;
  readonly enabled: boolean;
}

export const CHANNELS = {
  providers: {
    list: "core:providers:list",
    get: "core:providers:get",
    create: "core:providers:create",
    update: "core:providers:update",
    remove: "core:providers:remove",
  },
  profiles: {
    list: "core:profiles:list",
    get: "core:profiles:get",
    create: "core:profiles:create",
    update: "core:profiles:update",
    remove: "core:profiles:remove",
    apply: "core:profiles:apply",
    addModel: "core:profiles:add-model",
    updateModel: "core:profiles:update-model",
    removeModel: "core:profiles:remove-model",
    syncPlan: "core:profiles:sync-plan",
    syncApply: "core:profiles:sync-apply",
    inspect: "core:profiles:inspect",
    changed: "core:profiles:changed",
  },
  gateway: {
    status: "core:gateway:status",
    start: "core:gateway:start",
    stop: "core:gateway:stop",
    changed: "core:gateway:changed",
  },
  overview: {
    get: "core:overview:get",
  },
  status: {
    get: "core:status:get",
  },
  usage: {
    view: "claude-harbor:usage:view",
    refresh: "claude-harbor:usage:refresh",
    changed: "claude-harbor:usage:changed",
    sourcesGet: "claude-harbor:usage:sources:get",
    sourcesSave: "claude-harbor:usage:sources:save",
    configGet: "claude-harbor:usage:config:get",
    configSave: "claude-harbor:usage:config:save",
  },
  dialog: {
    pickDirectory: "claude-harbor:dialog:pick-directory",
  },
} as const;

/** preload 暴露的 core API（contextBridge 上除主题/文件选择外的部分）。 */
export interface CoreBridge {
  readonly providers: {
    list(): Promise<AppResult<ProviderSummary[]>>;
    get(id: string): Promise<AppResult<ProviderDetail>>;
    create(input: ProviderInput): Promise<AppResult<ProviderSummary>>;
    update(id: string, patch: ProviderPatch): Promise<AppResult<ProviderSummary>>;
    remove(id: string): Promise<AppResult<void>>;
  };
  readonly profiles: {
    list(): Promise<AppResult<ProfileSummary[]>>;
    get(id: string): Promise<AppResult<ProfileDetail>>;
    create(input: ProfileCreateInput): Promise<AppResult<ProfileDetail>>;
    update(id: string, patch: ProfileUpdateInput): Promise<AppResult<ProfileDetail>>;
    remove(id: string): Promise<AppResult<void>>;
    apply(id: string): Promise<AppResult<unknown>>;
    addModel(id: string, model: ModelInput): Promise<AppResult<ProfileDetail>>;
    updateModel(id: string, previousName: string, model: ModelInput): Promise<AppResult<ProfileDetail>>;
    removeModel(id: string, modelName: string): Promise<AppResult<ProfileDetail>>;
    syncPlan(id: string): Promise<AppResult<unknown>>;
    syncApply(id: string, decisions: unknown): Promise<AppResult<void>>;
    inspect(): Promise<AppResult<unknown>>;
    onChanged(callback: () => void): () => void;
  };
  readonly gateway: {
    status(): Promise<GatewayStatus>;
    start(id: string): Promise<AppResult<GatewayStatus>>;
    stop(): Promise<AppResult<GatewayStatus>>;
    onStatus(callback: (status: GatewayStatus) => void): () => void;
  };
  readonly overview: { get(): Promise<AppResult<OverviewData>> };
  readonly status: { get(): Promise<AppResult<StatusData>> };
  readonly usage: {
    getView(query: UsageViewQuery): Promise<AppResult<UsageViewDto>>;
    refresh(): Promise<AppResult<UsageSyncResultDto>>;
    getSources(): Promise<AppResult<UsageSourceDto[]>>;
    saveSources(sources: readonly UsageSourceDto[]): Promise<AppResult<UsageSourceDto[]>>;
    getConfig(): Promise<AppResult<UsageConfigDto>>;
    saveConfig(config: UsageConfigDto): Promise<AppResult<UsageConfigDto>>;
    onChanged(callback: (event: UsageChangedEvent) => void): () => void;
  };
  readonly dialog: {
    pickDirectory(): Promise<AppResult<string | null>>;
  };
}
