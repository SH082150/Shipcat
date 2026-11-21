import os from "node:os";
import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS } from "../shared/ipc.ts";

const THEME_CHANNELS = {
  get: "claude-harbor:theme:get",
  set: "claude-harbor:theme:set",
  changed: "claude-harbor:theme:changed",
};

const WEATHER_CHANNEL = "claude-harbor:weather:get";
const SYSTEM_CHANNELS = {
  get: "claude-harbor:system:get",
  setLaunch: "claude-harbor:system:set-launch",
  setBackground: "claude-harbor:system:set-background",
};

const FILE_CHANNELS = {
  usageProfile: "claude-harbor:usage-profile:pick",
  avatar: "claude-harbor:avatar:pick",
};

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const subscribe = (channel: string, callback: (value: unknown) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("claudeHarbor", {
  getUsername(): string {
    try {
      return os.userInfo().username;
    } catch {
      return "";
    }
  },
  getTheme: () => invoke(THEME_CHANNELS.get),
  setTheme: (mode: string) => invoke(THEME_CHANNELS.set, mode),
  onThemeChange(callback: (theme: string) => void) {
    if (typeof callback !== "function") throw new TypeError("onThemeChange expects a function");
    return subscribe(THEME_CHANNELS.changed, (value) => callback(String(value)));
  },
  pickUsageProfileFile: () => invoke(FILE_CHANNELS.usageProfile),
  pickAvatarFile: () => invoke(FILE_CHANNELS.avatar),
  getWeather: () => invoke(WEATHER_CHANNEL),
  system: {
    get: () => invoke(SYSTEM_CHANNELS.get),
    setLaunchAtLogin: (value: boolean) => invoke(SYSTEM_CHANNELS.setLaunch, value),
    setBackgroundOnClose: (value: boolean) => invoke(SYSTEM_CHANNELS.setBackground, value),
  },

  providers: {
    list: () => invoke(CHANNELS.providers.list),
    get: (id: string) => invoke(CHANNELS.providers.get, id),
    create: (input: unknown) => invoke(CHANNELS.providers.create, input),
    update: (id: string, patch: unknown) => invoke(CHANNELS.providers.update, id, patch),
    remove: (id: string) => invoke(CHANNELS.providers.remove, id),
  },
  profiles: {
    list: () => invoke(CHANNELS.profiles.list),
    get: (id: string) => invoke(CHANNELS.profiles.get, id),
    create: (input: unknown) => invoke(CHANNELS.profiles.create, input),
    update: (id: string, patch: unknown) => invoke(CHANNELS.profiles.update, id, patch),
    remove: (id: string) => invoke(CHANNELS.profiles.remove, id),
    apply: (id: string) => invoke(CHANNELS.profiles.apply, id),
    addModel: (id: string, model: unknown) => invoke(CHANNELS.profiles.addModel, id, model),
    updateModel: (id: string, previousName: string, model: unknown) =>
      invoke(CHANNELS.profiles.updateModel, id, previousName, model),
    removeModel: (id: string, modelName: string) => invoke(CHANNELS.profiles.removeModel, id, modelName),
    syncPlan: (id: string) => invoke(CHANNELS.profiles.syncPlan, id),
    syncApply: (id: string, decisions: unknown) => invoke(CHANNELS.profiles.syncApply, id, decisions),
    inspect: () => invoke(CHANNELS.profiles.inspect),
    onChanged(callback: () => void) {
      if (typeof callback !== "function") throw new TypeError("onChanged expects a function");
      return subscribe(CHANNELS.profiles.changed, callback);
    },
  },
  gateway: {
    status: () => invoke(CHANNELS.gateway.status),
    start: (id: string) => invoke(CHANNELS.gateway.start, id),
    stop: () => invoke(CHANNELS.gateway.stop),
    onStatus(callback: (status: unknown) => void) {
      if (typeof callback !== "function") throw new TypeError("onStatus expects a function");
      return subscribe(CHANNELS.gateway.changed, callback);
    },
  },
  overview: { get: () => invoke(CHANNELS.overview.get) },
  status: { get: () => invoke(CHANNELS.status.get) },
  usage: {
    sync: () => invoke(CHANNELS.usage.sync),
    aggregate: (filter: unknown) => invoke(CHANNELS.usage.aggregate, filter),
    buckets: (range: string) => invoke(CHANNELS.usage.buckets, range),
  },
});
