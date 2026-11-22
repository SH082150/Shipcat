import { BrowserWindow, ipcMain } from "electron";
import { CHANNELS } from "../shared/ipc.ts";
import type {
  AppResult,
  ModelInput,
  ProfileCreateInput,
  ProfileUpdateInput,
  ProviderInput,
  ProviderPatch,
  UsageFilter,
  UsageViewQuery,
} from "../shared/ipc.ts";
import { run } from "./services/errors.ts";
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
  aggregateUsage,
  getUsageView,
  loadUsageBuckets,
  refreshUsage,
  syncUsage,
} from "./services/usage.ts";
import { GatewayService } from "./services/gateway.ts";
import type { UsageIngestService } from "../../core/usage/ingest/service.ts";

function usageUnavailable(): AppResult<never> {
  return {
    ok: false,
    error: { code: "UNAVAILABLE", message: "用量服务暂时不可用。" },
  };
}

export function registerCoreIpc(
  gateway: GatewayService,
  usageService: UsageIngestService | null,
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
  ipcMain.handle(CHANNELS.usage.sync, () => run(() => syncUsage()));
  ipcMain.handle(CHANNELS.usage.aggregate, (_event, filter: UsageFilter) =>
    run(() => aggregateUsage(filter)),
  );
  ipcMain.handle(CHANNELS.usage.buckets, (_event, range: "30min" | "1h" | "1d") =>
    run(() => loadUsageBuckets(range)),
  );
  ipcMain.handle(CHANNELS.usage.view, (_event, query: UsageViewQuery) =>
    usageService === null ? usageUnavailable() : run(() => getUsageView(usageService, query)),
  );
  ipcMain.handle(CHANNELS.usage.refresh, () =>
    usageService === null ? usageUnavailable() : run(() => refreshUsage(usageService)),
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
