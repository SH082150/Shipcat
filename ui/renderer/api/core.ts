/**
 * 渲染层访问 core 的唯一入口：解包主进程结果信封，错误统一抛 CoreRequestError。
 * 页面/组件不要直接摸 window.claudeHarbor。
 */

import type { SyncDecisions, SyncPlan } from "../../../core/sync/index.ts";
import type { ClaudeDriftReport } from "../../../core/check/index.ts";
import type {
  AppError,
  AppResult,
  CoreBridge,
  GatewayStatus,
  ModelInput,
  OverviewData,
  ProfileCreateInput,
  ProfileDetail,
  ProfileSummary,
  ProfileUpdateInput,
  ProviderDetail,
  ProviderInput,
  ProviderPatch,
  ProviderSummary,
  MonitorPageDto,
  MonitorQueryDto,
  MonitorRecordDto,
  UsageConfigDto,
  UsageViewDto,
  UsageViewQuery,
} from "../../shared/ipc.ts";

export class CoreRequestError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(error: AppError) {
    super(error.message);
    this.name = "CoreRequestError";
    this.code = error.code;
    if (error.details !== undefined) this.details = error.details;
  }
}

function bridge(): CoreBridge {
  const value = (window as unknown as { claudeHarbor?: Partial<CoreBridge> }).claudeHarbor;
  if (!value?.providers || !value.profiles) {
    throw new Error("Shipcat bridge is unavailable");
  }
  return value as CoreBridge;
}

async function unwrap<T>(pending: Promise<AppResult<T>>): Promise<T> {
  const result = await pending;
  if (result.ok) return result.value;
  throw new CoreRequestError(result.error);
}

export const providersApi = {
  list: (): Promise<ProviderSummary[]> => unwrap(bridge().providers.list()),
  get: (id: string): Promise<ProviderDetail> => unwrap(bridge().providers.get(id)),
  create: (input: ProviderInput): Promise<ProviderSummary> => unwrap(bridge().providers.create(input)),
  update: (id: string, patch: ProviderPatch): Promise<ProviderSummary> =>
    unwrap(bridge().providers.update(id, patch)),
  remove: (id: string): Promise<void> => unwrap(bridge().providers.remove(id)),
};

export const profilesApi = {
  list: (): Promise<ProfileSummary[]> => unwrap(bridge().profiles.list()),
  get: (id: string): Promise<ProfileDetail> => unwrap(bridge().profiles.get(id)),
  create: (input: ProfileCreateInput): Promise<ProfileDetail> => unwrap(bridge().profiles.create(input)),
  update: (id: string, patch: ProfileUpdateInput): Promise<ProfileDetail> =>
    unwrap(bridge().profiles.update(id, patch)),
  remove: (id: string): Promise<void> => unwrap(bridge().profiles.remove(id)),
  apply: (id: string): Promise<unknown> => unwrap(bridge().profiles.apply(id)),
  addModel: (id: string, model: ModelInput): Promise<ProfileDetail> =>
    unwrap(bridge().profiles.addModel(id, model)),
  updateModel: (id: string, previousName: string, model: ModelInput): Promise<ProfileDetail> =>
    unwrap(bridge().profiles.updateModel(id, previousName, model)),
  removeModel: (id: string, modelName: string): Promise<ProfileDetail> =>
    unwrap(bridge().profiles.removeModel(id, modelName)),
};

export const gatewayApi = {
  status: (): Promise<GatewayStatus> => bridge().gateway.status(),
  start: (id: string): Promise<GatewayStatus> => unwrap(bridge().gateway.start(id)),
  stop: (): Promise<GatewayStatus> => unwrap(bridge().gateway.stop()),
  onStatus: (callback: (status: GatewayStatus) => void): (() => void) =>
    bridge().gateway.onStatus(callback),
};

export const syncApi = {
  plan: (id: string): Promise<SyncPlan> =>
    unwrap(bridge().profiles.syncPlan(id) as Promise<AppResult<SyncPlan>>),
  apply: (id: string, decisions: SyncDecisions): Promise<void> =>
    unwrap(bridge().profiles.syncApply(id, decisions) as Promise<AppResult<void>>),
  inspect: (): Promise<ClaudeDriftReport> =>
    unwrap(bridge().profiles.inspect() as Promise<AppResult<ClaudeDriftReport>>),
  onChanged: (callback: () => void): (() => void) => bridge().profiles.onChanged(callback),
};

export const monitorApi = {
  query: (input: MonitorQueryDto): Promise<MonitorPageDto> =>
    unwrap(bridge().monitor.query(input)),
  rebuild: (): Promise<unknown> => unwrap(bridge().monitor.rebuild()),
  onRecord: (callback: (record: MonitorRecordDto) => void): (() => void) =>
    bridge().monitor.onRecord(callback),
};

export const overviewApi = { get: (): Promise<OverviewData> => unwrap(bridge().overview.get()) };
export const usageApi = {
  getView: (query: UsageViewQuery): Promise<UsageViewDto> =>
    unwrap(bridge().usage.getView(query)),
  refresh: (): Promise<unknown> => unwrap(bridge().usage.refresh()),
  getConfig: (): Promise<UsageConfigDto> => unwrap(bridge().usage.getConfig()),
  saveConfig: (config: UsageConfigDto): Promise<UsageConfigDto> =>
    unwrap(bridge().usage.saveConfig(config)),
  onChanged: (callback: (revision: number) => void): (() => void) =>
    bridge().usage.onChanged((event) => callback(event.revision)),
};
