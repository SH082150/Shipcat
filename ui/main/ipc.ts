import { BrowserWindow, dialog, ipcMain } from "electron";
import { isAbsolute } from "node:path";
import { CHANNELS } from "../shared/ipc.ts";
import type {
  AppResult,
  ModelInput,
  ProfileCreateInput,
  ProfileUpdateInput,
  ProviderInput,
  ProviderPatch,
  UsageSourceDto,
  UsageViewQuery,
} from "../shared/ipc.ts";
import { loadSettings, saveSettings } from "../../core/settings/index.ts";
import type { Settings, SettingsSource } from "../../core/settings/index.ts";
import { resolveUsageSourceRoot } from "../../core/settings/paths.ts";
import { run, ServiceError } from "./services/errors.ts";
import {
  createProvider,
  getProvider,
  listProviders,
  removeProvider,
  updateProvider,
} from "./services/providers.ts";
import {
  addModel,
  applyProfile,
  createProfile,
  getProfile,
  listProfiles,
  removeModel,
  removeProfile,
  updateModel,
  updateProfile,
} from "./services/profiles.ts";
import { getOverview, getStatus } from "./services/status.ts";
import { applySync, getSyncPlan, inspectProfiles, watchProfiles } from "./services/sync.ts";
import {
  getUsageConfig,
  getUsageView,
  refreshUsage,
  saveUsageConfig,
} from "./services/usage.ts";
import { GatewayService } from "./services/gateway.ts";
import type { UsageService } from "../../core/usage/service.ts";
import type { MonitorService } from "../../core/monitor/service.ts";
import { readRecentMonitorRecords } from "../../core/monitor/query.ts";
import type { MonitorRecord, MonitorRecordEvent } from "../../core/monitor/index.ts";
import type {
  LimitRemoteDto,
  LimitWindowKeyDto,
  LimitProfileDetailDto,
  LimitProfileInputDto,
  LimitProfilePatchDto,
  LimitProfileSummaryDto,
  LimitTestInputDto,
  LimitTestResultDto,
  LimitViewDto,
  LimitViewQueryDto,
  MonitorPageDto,
  MonitorRecordDto,
} from "../shared/ipc.ts";
import * as core from "../../core/index.ts";
import type { QuotaQueryOutcome } from "../../core/quota/script/types.ts";

const MONITOR_BUFFER_LIMIT = 500;
/** 主进程查询缓存最多读取的历史条数；分页在缓存上完成，不再整包发给渲染层。 */
const MONITOR_HISTORY_LIMIT = 50_000;
const MONITOR_PAGE_MAX = 500;

let providerNamesCache: { at: number; names: Record<string, string> } | null = null;

/** 供应商 UUID → 显示名；30 秒缓存，避免每条实时记录都重读档案。 */
function monitorProviderNames(): Record<string, string> {
  const now = Date.now();
  if (providerNamesCache !== null && now - providerNamesCache.at < 30_000) {
    return providerNamesCache.names;
  }
  let names: Record<string, string> = {};
  try {
    names = Object.fromEntries(listProviders().map((provider) => [provider.id, provider.name]));
  } catch {
    names = {};
  }
  providerNamesCache = { at: now, names };
  return names;
}

function toMonitorDto(
  event: MonitorRecordEvent | MonitorRecord,
  names: Readonly<Record<string, string>> = {},
): MonitorRecordDto {
  const rawLine = "rawLine" in event ? event.rawLine : "";
  const eventId = "eventId" in event ? event.eventId : event.id ?? "";
  const providerNames: Record<string, string> = {};
  for (const id of Object.keys(event.provider)) {
    const name = names[id];
    if (name !== undefined) providerNames[id] = name;
  }
  return {
    eventId,
    ts: event.ts,
    surface: event.surface,
    origin: event.origin,
    sessionId: event.sessionId,
    isError: event.isError,
    provider: event.provider,
    providerNames: Object.keys(providerNames).length === 0 ? undefined : providerNames,
    tools: event.tools,
    rawLine,
  };
}

function usageUnavailable(): AppResult<never> {
  return {
    ok: false,
    error: { code: "UNAVAILABLE", message: "用量服务暂时不可用。" },
  };
}

const SOURCE_KINDS = new Set(["claude-desktop", "custom"]);

/** 设置里的来源 → 设置页 DTO；resolvedRoot 由主进程按平台解析。 */
function toSourceDtos(settings: Settings): UsageSourceDto[] {
  return settings.usage.sources.map((source) => ({
    id: source.id,
    kind: source.kind,
    root: source.root,
    resolvedRoot: resolveUsageSourceRoot(source.root),
    enabled: source.enabled,
  }));
}

/** 渲染层提交的来源列表：字段校验 + 去重；非法输入返回 null。 */
function parseSources(value: unknown): SettingsSource[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const sources: SettingsSource[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") return null;
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (id.length === 0 || seen.has(id)) return null;
    seen.add(id);
    const kind = typeof raw.kind === "string" ? raw.kind.trim() : "";
    if (!SOURCE_KINDS.has(kind)) return null;
    let root: string | null = null;
    if (typeof raw.root === "string" && raw.root.trim().length > 0) {
      const candidate = raw.root.trim();
      if (!isAbsolute(candidate)) return null;
      root = candidate;
    }
    sources.push({ id, kind, root, enabled: raw.enabled !== false });
  }
  // 单账号：只保留第一个启用来源，避免历史配置里多来源静默并存。
  return sources.filter((source) => source.enabled).slice(0, 1);
}

interface ParsedMonitorQuery {
  readonly surface: string;
  readonly query: string;
  readonly offset: number;
  readonly limit: number;
}

/** 渲染层传入的 Monitor 查询：offset 从最新一条开始，limit 受上限保护。 */
function parseMonitorQuery(value: unknown): ParsedMonitorQuery | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const surface = typeof raw.surface === "string" ? raw.surface : "all";
  if (surface !== "all" && surface !== "chat" && surface !== "cowork" && surface !== "code") {
    return null;
  }
  const query = typeof raw.query === "string" ? raw.query.trim().toLowerCase() : "";
  if (
    typeof raw.offset !== "number" ||
    !Number.isFinite(raw.offset) ||
    raw.offset < 0 ||
    typeof raw.limit !== "number" ||
    !Number.isFinite(raw.limit) ||
    raw.limit <= 0
  ) {
    return null;
  }
  return {
    surface,
    query,
    offset: Math.trunc(raw.offset),
    limit: Math.min(Math.trunc(raw.limit), MONITOR_PAGE_MAX),
  };
}

type RawRemote = {
  readonly used?: number;
  readonly limit?: number;
  readonly remaining?: number;
  readonly resetAt?: number;
  readonly unit?: string;
  readonly note?: string;
};

function toRemoteDto(reading: RawRemote): LimitRemoteDto {
  const unit =
    reading.unit === "requests" || reading.unit === "percent" || reading.unit === "currency"
      ? reading.unit
      : "tokens";
  return {
    ...(reading.used === undefined ? {} : { used: reading.used }),
    ...(reading.limit === undefined ? {} : { limit: reading.limit }),
    ...(reading.remaining === undefined ? {} : { remaining: reading.remaining }),
    ...(reading.resetAt === undefined ? {} : { resetAt: reading.resetAt }),
    ...(reading.note === undefined ? {} : { note: reading.note }),
    unit,
  };
}

function toLimitViewDto(view: core.quota.LimitView): LimitViewDto {
  return {
    profileId: view.profileId,
    providerId: view.providerId,
    ok: view.ok,
    fetchedAt: view.fetchedAt,
    windows: view.windows.map((window) => ({
      key: window.key as LimitWindowKeyDto,
      range: window.range,
      remote: toRemoteDto(window.remote),
      local: window.local,
    })),
    ...(view.balance === undefined ? {} : { balance: view.balance }),
    ...(view.error === undefined ? {} : { error: view.error }),
    ...(view.truncated === true ? { truncated: true } : {}),
  };
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ServiceError("INVALID", `${label}不能为空。`);
  }
  return value;
}

function parseLimitProfileInput(value: unknown): core.limitProfiles.CreateLimitProfileInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceError("INVALID", "额度配置参数不合法。");
  }
  const raw = value as Record<string, unknown>;
  return {
    name: requireString(raw.name, "名称"),
    providerId: requireString(raw.providerId, "供应商 id"),
    script: requireString(raw.script, "脚本"),
    ...(typeof raw.timeoutMs === "number" ? { timeoutMs: raw.timeoutMs } : {}),
    ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
  };
}

function parseLimitProfilePatch(value: unknown): core.limitProfiles.UpdateLimitProfileInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceError("INVALID", "额度配置参数不合法。");
  }
  const raw = value as Record<string, unknown>;
  return {
    ...(typeof raw.name === "string" ? { name: raw.name } : {}),
    ...(typeof raw.script === "string" ? { script: raw.script } : {}),
    ...(typeof raw.timeoutMs === "number" ? { timeoutMs: raw.timeoutMs } : {}),
    ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
  };
}

function parseLimitTestInput(value: unknown): { providerId: string; script: string; timeoutMs: number } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceError("INVALID", "测试参数不合法。");
  }
  const raw = value as Record<string, unknown>;
  const script = requireString(raw.script, "脚本");
  if (script.length > 200_000) {
    throw new ServiceError("INVALID", "脚本超过 200KB 上限。");
  }
  return {
    providerId: requireString(raw.providerId, "供应商 id"),
    script,
    timeoutMs:
      typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs)
        ? Math.min(60_000, Math.max(500, Math.trunc(raw.timeoutMs)))
        : 8_000,
  };
}

function parseLimitViewQuery(value: unknown): { profileId: string; force: boolean } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceError("INVALID", "额度查询参数不合法。");
  }
  const raw = value as Record<string, unknown>;
  return {
    profileId: requireString(raw.profileId, "额度配置 id"),
    force: raw.force === true,
  };
}

export function registerCoreIpc(
  gateway: GatewayService,
  usageService: UsageService | null,
  monitorService: MonitorService | null = null,
): void {
  const monitorBuffer: MonitorRecordEvent[] = [];
  /** 全量记录缓存；新事件到达或重建后置空，下次查询重新读盘。 */
  let monitorCache: MonitorRecordDto[] | null = null;

  const monitorRecords = (): MonitorRecordDto[] => {
    if (monitorCache !== null) return monitorCache;
    const merged = new Map<string, MonitorRecordDto>();
    const names = monitorProviderNames();
    const root = monitorService?.getRoot();
    if (root !== undefined) {
      for (const record of readRecentMonitorRecords(root, MONITOR_HISTORY_LIMIT)) {
        const dto = toMonitorDto(record, names);
        merged.set(dto.eventId, dto);
      }
    }
    for (const event of monitorBuffer) {
      const dto = toMonitorDto(event, names);
      merged.set(dto.eventId, dto);
    }
    monitorCache = [...merged.values()].sort((a, b) => a.ts - b.ts);
    return monitorCache;
  };

  const broadcastMonitor = (event: MonitorRecordEvent): void => {
    monitorBuffer.push(event);
    if (monitorBuffer.length > MONITOR_BUFFER_LIMIT) {
      monitorBuffer.splice(0, monitorBuffer.length - MONITOR_BUFFER_LIMIT);
    }
    monitorCache = null;
    const dto = toMonitorDto(event, monitorProviderNames());
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(CHANNELS.monitor.record, dto);
      }
    }
  };
  monitorService?.onRecord(broadcastMonitor);

  ipcMain.handle(CHANNELS.monitor.query, (_event, input: unknown) =>
    run((): MonitorPageDto => {
      const parsed = parseMonitorQuery(input);
      if (parsed === null) {
        throw new ServiceError("INVALID", "Monitor 查询参数不合法。");
      }
      const textOf = (record: MonitorRecordDto): string =>
        [
          record.sessionId ?? "",
          record.surface,
          record.origin,
          ...Object.keys(record.provider),
          ...Object.values(record.providerNames ?? {}),
          ...Object.keys(record.tools),
          ...Object.values(record.provider).flatMap((models) => Object.keys(models)),
        ]
          .join(" ")
          .toLowerCase();

      const ordered = monitorRecords()
        .slice()
        .reverse()
        .filter(
          (record) =>
            (parsed.surface === "all" || record.surface === parsed.surface) &&
            (parsed.query.length === 0 || textOf(record).includes(parsed.query)),
        );

      const totals = ordered.reduce(
        (sum, record) => {
          for (const models of Object.values(record.provider)) {
            for (const usage of Object.values(models)) {
              sum.tokens +=
                usage.inputTokens +
                usage.outputTokens +
                usage.cacheReadTokens +
                usage.cacheWriteTokens;
              sum.outputTokens += usage.outputTokens;
              sum.cacheReadTokens += usage.cacheReadTokens;
              sum.cacheableTokens +=
                usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
            }
          }
          return sum;
        },
        { tokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheableTokens: 0 },
      );

      return {
        total: ordered.length,
        records: ordered.slice(parsed.offset, parsed.offset + parsed.limit),
        totals,
      };
    }),
  );
  ipcMain.handle(CHANNELS.monitor.rebuild, () =>
    monitorService === null
      ? run(async () => {
          throw new ServiceError("UNAVAILABLE", "Monitor 服务暂时不可用。");
        })
      : run(async () => {
          try {
            return await monitorService.rebuild();
          } finally {
            // 重建不触发 onRecord；旧缓冲会按同一 eventId 覆盖重建后的 unknown 归属。
            monitorBuffer.length = 0;
            monitorCache = null;
          }
        }),
  );

  const limitViewCache = new Map<string, { at: number; outcome: QuotaQueryOutcome }>();
  const limitViewInflight = new Map<string, Promise<QuotaQueryOutcome>>();
  const LIMIT_VIEW_TTL_MS = 5 * 60_000;
  /** 配置/供应商变更后自增，使在途查询的结果不再写回缓存。 */
  let limitViewEpoch = 0;
  const invalidateLimitViews = (): void => {
    limitViewEpoch += 1;
    limitViewCache.clear();
  };

  const summarizeLimitProfile = (entry: { id: string; name: string }): LimitProfileSummaryDto => {
    try {
      const { profile } = core.limitProfiles.getById(entry.id);
      return { id: entry.id, name: entry.name, providerId: profile.providerId, enabled: profile.enabled };
    } catch {
      return { id: entry.id, name: entry.name, providerId: "", enabled: false };
    }
  };

  const detailLimitProfile = (
    found: { entry: { id: string; name: string }; profile: core.limitProfiles.LimitProfile } | null,
  ): LimitProfileDetailDto | null => {
    if (found === null) return null;
    return {
      id: found.entry.id,
      name: found.entry.name,
      providerId: found.profile.providerId,
      enabled: found.profile.enabled,
      script: found.profile.script,
      timeoutMs: found.profile.timeoutMs,
    };
  };

  ipcMain.handle(CHANNELS.limitProfiles.list, () =>
    run(() => core.limitProfiles.list().map(summarizeLimitProfile)),
  );
  ipcMain.handle(CHANNELS.limitProfiles.getByProvider, (_event, providerId: unknown) =>
    run(() => {
      if (typeof providerId !== "string" || providerId.length === 0) {
        throw new ServiceError("INVALID", "供应商 id 不合法。");
      }
      return detailLimitProfile(core.limitProfiles.getByProvider(providerId));
    }),
  );
  ipcMain.handle(CHANNELS.limitProfiles.create, (_event, input: unknown) =>
    run(() => {
      const parsed = parseLimitProfileInput(input);
      const entry = core.limitProfiles.create(parsed);
      return summarizeLimitProfile(entry);
    }),
  );
  ipcMain.handle(CHANNELS.limitProfiles.update, (_event, id: unknown, patch: unknown) =>
    run(() => {
      if (typeof id !== "string" || id.length === 0) {
        throw new ServiceError("INVALID", "额度配置 id 不合法。");
      }
      const parsed = parseLimitProfilePatch(patch);
      const entry = core.limitProfiles.update(id, parsed);
      invalidateLimitViews();
      return summarizeLimitProfile(entry);
    }),
  );
  ipcMain.handle(CHANNELS.limitProfiles.remove, (_event, id: unknown) =>
    run(() => {
      if (typeof id !== "string" || id.length === 0) {
        throw new ServiceError("INVALID", "额度配置 id 不合法。");
      }
      core.limitProfiles.remove(id);
      invalidateLimitViews();
    }),
  );
  ipcMain.handle(CHANNELS.limitProfiles.test, (_event, input: unknown) =>
    run(async (): Promise<LimitTestResultDto> => {
      const parsed = parseLimitTestInput(input);
      const outcome = await core.quota.script.queryProfileQuota({
        id: "test",
        providerId: parsed.providerId,
        script: parsed.script,
        timeoutMs: parsed.timeoutMs,
        enabled: true,
      });
      const result = outcome.result;
      return {
        ok: outcome.ok,
        fetchedAt: outcome.fetchedAt,
        ...(result === undefined
          ? {}
          : {
              result: {
                ...(result.windows === undefined
                  ? {}
                  : {
                      windows: Object.fromEntries(
                        Object.entries(result.windows).map(([key, reading]) => [
                          key,
                          reading === undefined ? reading : toRemoteDto(reading),
                        ]),
                      ),
                    }),
                ...(result.balance === undefined ? {} : { balance: result.balance }),
              },
            }),
        ...(outcome.error === undefined ? {} : { error: outcome.error }),
      };
    }),
  );
  ipcMain.handle(CHANNELS.limit.view, (_event, input: unknown) =>
    run(async (): Promise<LimitViewDto> => {
      const parsed = parseLimitViewQuery(input);
      const found = core.limitProfiles.getById(parsed.profileId);
      const cached = limitViewCache.get(parsed.profileId);
      let outcome: QuotaQueryOutcome;
      if (!parsed.force && cached !== undefined && Date.now() - cached.at < LIMIT_VIEW_TTL_MS) {
        outcome = cached.outcome;
      } else {
        const epoch = limitViewEpoch;
        let pending = parsed.force ? undefined : limitViewInflight.get(parsed.profileId);
        if (pending === undefined) {
          pending = core.quota.script
            .queryProfileQuota({
              id: found.entry.id,
              providerId: found.profile.providerId,
              script: found.profile.script,
              timeoutMs: found.profile.timeoutMs,
              enabled: found.profile.enabled,
            })
            .then((result) => {
              if (epoch === limitViewEpoch) {
                limitViewCache.set(parsed.profileId, { at: Date.now(), outcome: result });
              }
              return result;
            })
            .finally(() => {
              if (limitViewInflight.get(parsed.profileId) === pending) {
                limitViewInflight.delete(parsed.profileId);
              }
            });
          limitViewInflight.set(parsed.profileId, pending);
        }
        outcome = await pending;
      }
      const records = monitorRecords();
      return toLimitViewDto(
        core.quota.buildLimitView({
          profileId: found.entry.id,
          providerId: found.profile.providerId,
          outcome,
          records,
          truncated: records.length >= MONITOR_HISTORY_LIMIT,
        }),
      );
    }),
  );
  ipcMain.handle(CHANNELS.providers.list, () => run(() => listProviders()));
  ipcMain.handle(CHANNELS.providers.get, (_event, id: string) => run(() => getProvider(id)));
  const invalidateProviderCaches = (): void => {
    providerNamesCache = null;
    monitorCache = null;
    invalidateLimitViews();
  };

  ipcMain.handle(CHANNELS.providers.create, (_event, input: ProviderInput) =>
    run(() => {
      const result = createProvider(input);
      invalidateProviderCaches();
      return result;
    }),
  );
  ipcMain.handle(CHANNELS.providers.update, (_event, id: string, patch: ProviderPatch) =>
    run(() => {
      const result = updateProvider(id, patch);
      invalidateProviderCaches();
      return result;
    }),
  );
  ipcMain.handle(CHANNELS.providers.remove, (_event, id: string) =>
    run(() => {
      const providerId = getProvider(id).id;
      const result = removeProvider(id);
      invalidateProviderCaches();
      const limitProfile = core.limitProfiles.getByProvider(providerId);
      if (limitProfile !== null) {
        core.limitProfiles.remove(limitProfile.entry.id);
        limitViewCache.delete(limitProfile.entry.id);
      }
      return result;
    }),
  );

  ipcMain.handle(CHANNELS.profiles.list, () => run(() => listProfiles()));
  ipcMain.handle(CHANNELS.profiles.get, (_event, id: string) => run(() => getProfile(id)));
  ipcMain.handle(CHANNELS.profiles.create, (_event, input: ProfileCreateInput) => run(() => createProfile(input)));
  ipcMain.handle(CHANNELS.profiles.update, (_event, id: string, patch: ProfileUpdateInput) =>
    run(() => updateProfile(id, patch)),
  );
  ipcMain.handle(CHANNELS.profiles.remove, (_event, id: string) => run(() => removeProfile(id)));
  ipcMain.handle(CHANNELS.profiles.apply, (_event, id: string) => run(() => applyProfile(id)));
  ipcMain.handle(CHANNELS.profiles.addModel, (_event, id: string, model: ModelInput) =>
    run(() => addModel(id, model)),
  );
  ipcMain.handle(CHANNELS.profiles.updateModel, (_event, id: string, previousName: string, model: ModelInput) =>
    run(() => updateModel(id, previousName, model)),
  );
  ipcMain.handle(CHANNELS.profiles.removeModel, (_event, id: string, modelName: string) =>
    run(() => removeModel(id, modelName)),
  );
  ipcMain.handle(CHANNELS.profiles.syncPlan, (_event, id: string) => run(() => getSyncPlan(id)));
  ipcMain.handle(CHANNELS.profiles.syncApply, (_event, id: string, decisions: unknown) =>
    run(() => applySync(id, decisions)),
  );
  ipcMain.handle(CHANNELS.profiles.inspect, () => run(() => inspectProfiles()));

  ipcMain.handle(CHANNELS.gateway.status, () => gateway.status());
  ipcMain.handle(CHANNELS.gateway.start, (_event, id: string) => run(() => gateway.start(id)));
  ipcMain.handle(CHANNELS.gateway.stop, () => run(() => gateway.stop()));

  ipcMain.handle(CHANNELS.overview.get, () => run(() => getOverview(gateway)));
  ipcMain.handle(CHANNELS.status.get, () => run(() => getStatus()));
  ipcMain.handle(CHANNELS.usage.view, (_event, query: UsageViewQuery) =>
    usageService === null ? usageUnavailable() : run(() => getUsageView(usageService, query)),
  );
  ipcMain.handle(CHANNELS.usage.refresh, () =>
    usageService === null ? usageUnavailable() : run(() => refreshUsage(usageService)),
  );
  ipcMain.handle(CHANNELS.usage.configGet, () =>
    usageService === null ? usageUnavailable() : run(() => getUsageConfig(usageService)),
  );
  ipcMain.handle(CHANNELS.usage.configSave, (_event, value: unknown) =>
    usageService === null
      ? usageUnavailable()
      : run(async () => {
          const previousTimezone = usageService.getConfig().timezone;
          const config = saveUsageConfig(usageService, value);
          if (config.timezone !== previousTimezone) await usageService.reloadSource();
          return config;
        }),
  );
  ipcMain.handle(CHANNELS.usage.sourcesGet, () => run(() => toSourceDtos(loadSettings())));
  ipcMain.handle(CHANNELS.usage.sourcesSave, (_event, input: unknown) =>
    run(async () => {
      const sources = parseSources(input);
      if (sources === null) {
        throw new ServiceError(
          "INVALID_SOURCES",
          "来源配置无效：请检查路径是否为绝对路径，且来源标识不重复。",
        );
      }
      const next: Settings = { version: 1, usage: { sources } };
      const saved = saveSettings(next);
      if (usageService !== null) await usageService.reloadSource();
      if (monitorService !== null) {
        // 来源切换后旧游标和旧归属都失效；下一次同步会按 source 变化重建。
        monitorBuffer.length = 0;
        monitorCache = null;
        void monitorService.requestSync("manual").catch((error) => {
          console.error("Monitor resync after source change failed:", error);
        });
      }
      return toSourceDtos(saved);
    }),
  );
  ipcMain.handle(CHANNELS.dialog.pickDirectory, () =>
    run(async () => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options = {
        title: "选择用量账本目录",
        properties: ["openDirectory"] as Array<"openDirectory">,
      };
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled) return null;
      return result.filePaths[0] ?? null;
    }),
  );

  usageService?.onChanged((revision) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(CHANNELS.usage.changed, { revision });
      }
    }
  });

  watchProfiles(() => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(CHANNELS.profiles.changed);
      }
    }
  });

  gateway.onStatus((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(CHANNELS.gateway.changed, status);
      }
    }
  });
}
