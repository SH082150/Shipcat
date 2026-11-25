import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from "electron";
import type { Tray } from "electron";
import { registerCoreIpc } from "./ipc.ts";
import { GatewayService } from "./services/gateway.ts";
import { loadPreferences, savePreferences } from "./services/preferences.ts";
import { createTray } from "./services/tray.ts";
import { createUsageService } from "./services/usage.ts";
import { createMonitorService } from "./services/monitor.ts";
import type { UsageService } from "../../core/usage/service.ts";
import type { MonitorService } from "../../core/monitor/service.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_INDEX = path.join(__dirname, "..", "renderer", "index.html");
const PRELOAD = path.join(__dirname, "preload.cjs");
/** 应用图标：开发态由 app.dock.setIcon 使用，打包后由构建产物的 .icns/.ico 接管。 */
const APP_ICON = path.join(__dirname, "..", "..", "assets", "icons", "icon.png");
/** 菜单栏 / 托盘图标：源图 32px，运行时按平台缩放。 */
const TRAY_ICON = path.join(__dirname, "..", "..", "assets", "icons", "icon-32.png");

// 前端产品名。内核仍叫 ClaudeHarbor，数据目录与 CLI 命令都不变。
app.setName("Shipcat");

const THEME_CHANNELS = {
  get: "claude-harbor:theme:get",
  set: "claude-harbor:theme:set",
  changed: "claude-harbor:theme:changed",
};
const THEME_SOURCES = new Set(["system", "light", "dark"]);

const WEATHER_CHANNEL = "claude-harbor:weather:get";
const SYSTEM_CHANNELS = {
  get: "claude-harbor:system:get",
  setLaunch: "claude-harbor:system:set-launch",
  setBackground: "claude-harbor:system:set-background",
  setHideDock: "claude-harbor:system:set-hide-dock",
};
const AVATAR_CHANNELS = { pick: "claude-harbor:avatar:pick" };

const AVATAR_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
const AVATAR_MAX_BYTES = 8 * 1024 * 1024;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let usageService: UsageService | null = null;
let monitorService: MonitorService | null = null;
let backgroundMode = false;
let hideDockMode = false;
let isQuitting = false;
let lastBroadcastTheme: "light" | "dark" = effectiveTheme();
const gateway = new GatewayService();

// 单实例锁：隐藏 Dock 后即使菜单栏图标被系统收纳，再次启动应用也能唤回窗口。
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function effectiveTheme(): "light" | "dark" {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? "#1f1e1d" : "#faf9f5";
}

/** 显示主窗口；窗口被销毁时重新创建。 */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * 应用 Dock / 任务栏可见性。
 * macOS 同时切换 activation policy：隐藏时变为 accessory（无 Dock 图标），
 * 恢复时回到 regular。Windows / Linux 通过 setSkipTaskbar 同步窗口。
 */
function applyDockVisibility(hide: boolean): void {
  if (process.platform === "darwin") {
    if (hide) app.dock?.hide();
    else app.dock?.show();

    const setPolicy = (
      app as unknown as {
        setActivationPolicy?: (policy: "regular" | "accessory") => void;
      }
    ).setActivationPolicy;
    if (typeof setPolicy === "function") {
      setPolicy.call(app, hide ? "accessory" : "regular");
    }
    return;
  }
  mainWindow?.setSkipTaskbar(hide);
}

function createTrayIcon(): void {
  try {
    tray = createTray({
      iconPath: TRAY_ICON,
      onShow: showMainWindow,
      onQuit: () => {
        isQuitting = true;
        app.quit();
      },
    });
  } catch (error) {
    console.error("Failed to create Shipcat tray:", error);
  }
}

function broadcastTheme(): void {
  const theme = effectiveTheme();
  if (theme === lastBroadcastTheme) return;
  lastBroadcastTheme = theme;

  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    window.setBackgroundColor(windowBackground());
    window.webContents.send(THEME_CHANNELS.changed, theme);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 860,
    minHeight: 600,
    show: false,
    icon: APP_ICON,
    title: "Shipcat",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.platform !== "darwin") mainWindow.setSkipTaskbar(hideDockMode);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("close", (event) => {
    if (backgroundMode && !isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadFile(RENDERER_INDEX).catch((error) => {
    console.error("Failed to load Shipcat UI:", error);
  });
}

ipcMain.handle(THEME_CHANNELS.get, () => nativeTheme.themeSource);
ipcMain.handle(THEME_CHANNELS.set, (_event, mode: unknown) => {
  if (typeof mode !== "string" || !THEME_SOURCES.has(mode)) {
    throw new TypeError(`Unsupported theme mode: ${String(mode)}`);
  }
  nativeTheme.themeSource = mode as "system" | "light" | "dark";
  broadcastTheme();
  return effectiveTheme();
});

ipcMain.handle(AVATAR_CHANNELS.pick, async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
  const options = {
    title: "选择头像",
    buttonLabel: "选择",
    properties: ["openFile"] as Array<"openFile">,
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  };
  try {
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return null;
    const buffer = await readFile(filePath);
    if (buffer.byteLength > AVATAR_MAX_BYTES) {
      console.warn(`Avatar image exceeds 8 MB limit: ${buffer.byteLength} bytes`);
      return null;
    }
    const extension = path.extname(filePath).slice(1).toLowerCase();
    const mime = AVATAR_MIME[extension] ?? "image/png";
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch (error) {
    console.error("Failed to read avatar image:", error);
    return null;
  }
});

let weatherCache: { at: number; value: unknown } | null = null;

ipcMain.handle(SYSTEM_CHANNELS.get, () => ({
  launchAtLogin: app.getLoginItemSettings().openAtLogin,
  backgroundOnClose: backgroundMode,
  hideDock: hideDockMode,
}));

ipcMain.handle(SYSTEM_CHANNELS.setLaunch, (_event, value: unknown) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(value) });
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle(SYSTEM_CHANNELS.setBackground, async (_event, value: unknown) => {
  backgroundMode = Boolean(value);
  await savePreferences({ backgroundOnClose: backgroundMode });
  return backgroundMode;
});

ipcMain.handle(SYSTEM_CHANNELS.setHideDock, async (_event, value: unknown) => {
  hideDockMode = Boolean(value);
  applyDockVisibility(hideDockMode);
  await savePreferences({ hideDock: hideDockMode });
  return hideDockMode;
});

ipcMain.handle(WEATHER_CHANNEL, async () => {
  if (weatherCache && Date.now() - weatherCache.at < 10 * 60_000) return weatherCache.value;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const response = await fetch("https://wttr.in/?format=j1", { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    const data = (await response.json()) as {
      current_condition?: {
        weatherCode?: string;
        weatherDesc?: { value?: string }[];
        temp_C?: string;
        windspeedKmph?: string;
      }[];
    };
    const current = data.current_condition?.[0];
    const code = Number(current?.weatherCode ?? 0);
    const kind =
      [200, 386, 389, 392, 395].includes(code) ? "heavy-rain" :
      [296, 299, 302, 305, 308, 356, 359].includes(code) ? "heavy-rain" :
      [176, 293, 311, 314, 353].includes(code) ? "rain" :
      [263, 266, 281, 284].includes(code) ? "drizzle" :
      [179, 182, 185, 317, 320, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377].includes(code) ? "snow" :
      [143, 248, 260].includes(code) ? "fog" :
      [113, 116].includes(code) ? "clear" :
      [119, 122].includes(code) ? "cloudy" : "cloudy";
    // 大风没有独立天气码，按风速覆盖晴/多云类问候。
    const windKmph = Number(current?.windspeedKmph ?? 0);
    const effectiveKind = windKmph >= 40 && (kind === "clear" || kind === "cloudy") ? "wind" : kind;
    const value = {
      kind: effectiveKind,
      temperature: Number(current?.temp_C ?? 0),
      description: current?.weatherDesc?.[0]?.value ?? "",
    };
    weatherCache = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
});

nativeTheme.on("updated", broadcastTheme);

app.whenReady().then(async () => {
  const preferences = await loadPreferences();
  backgroundMode = preferences.backgroundOnClose;
  hideDockMode = preferences.hideDock;

  // 用量服务：自建文件库（Layer 1 / Layer 2），启动时先跑一轮并开启常驻时钟。
  // 即使初始化失败，也要注册其余 IPC，避免设置/供应商页一起不可用。
  try {
    usageService = createUsageService();
  } catch (error) {
    console.error("Failed to create usage service:", error);
    usageService = null;
  }
  try {
    monitorService = createMonitorService();
  } catch (error) {
    console.error("Failed to create monitor service:", error);
    monitorService = null;
  }
  registerCoreIpc(gateway, usageService, monitorService);
  if (monitorService !== null) {
    const service = monitorService;
    void service.start().catch((error) => {
      console.error("Failed to start monitor service:", error);
    });
  }
  if (usageService !== null) {
    const service = usageService;
    void service.start().catch((error) => {
      console.error("Failed to start usage service:", error);
    });
  }

  // 开发态没有应用包，Dock 会沿用 Electron 的默认图标，这里手动换上小猫。
  if (process.platform === "darwin" && !app.isPackaged) app.dock?.setIcon(APP_ICON);
  createWindow();
  createTrayIcon();
  // 托盘是"隐藏 Dock 后还能找回应用"的唯一入口：托盘没建起来就不隐藏。
  if (hideDockMode && !tray) {
    hideDockMode = false;
    void savePreferences({ hideDock: false });
  }
  applyDockVisibility(hideDockMode);
  app.on("second-instance", () => showMainWindow());
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  void gateway.dispose();
  usageService?.dispose();
  usageService = null;
  monitorService?.dispose();
  monitorService = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
