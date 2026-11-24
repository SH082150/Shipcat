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

export function registerCoreIpc(
  gateway: GatewayService,
  usageService: UsageService | null,
): void {
  ipcMain.handle(CHANNELS.providers.list, () => run(() => listProviders()));
  ipcMain.handle(CHANNELS.providers.get, (_event, id: string) => run(() => getProvider(id)));
  ipcMain.handle(CHANNELS.providers.create, (_event, input: ProviderInput) => run(() => createProvider(input)));
  ipcMain.handle(CHANNELS.providers.update, (_event, id: string, patch: ProviderPatch) =>
    run(() => updateProvider(id, patch)),
  );
  ipcMain.handle(CHANNELS.providers.remove, (_event, id: string) => run(() => removeProvider(id)));

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
