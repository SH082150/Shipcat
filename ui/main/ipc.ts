import { BrowserWindow, ipcMain } from "electron";
import { CHANNELS } from "../shared/ipc.ts";
import type { ModelInput, ProfileCreateInput, ProfileUpdateInput, ProviderInput, ProviderPatch, UsageFilter } from "../shared/ipc.ts";
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
import { aggregateUsage, loadUsageBuckets, syncUsage } from "./services/usage.ts";
import { GatewayService } from "./services/gateway.ts";

export function registerCoreIpc(gateway: GatewayService): void {
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

  gateway.onStatus((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(CHANNELS.gateway.changed, status);
      }
    }
  });
}
