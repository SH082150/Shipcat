/**
 * 渲染器入口：唯一拥有 DOM 的模块。
 *
 * - 标题栏（drag region）里放侧栏开关，按钮自身 no-drag；
 * - 侧栏状态交给 state/sidebar.ts，这里只把 pointer 事件与订阅接上；
 * - 路由由 state/navigation.ts 解析：`#providers/:id` 与 `#profiles/:id`
 *   走页面模块的 renderDetail，回到列表仍用 data-page；
 * - 容器状态只写 data-view-*（viewPage/viewDetail/viewSearch/…），与事件委托的
 *   data-page、data-usage-range 等动作属性严格分离，点击容器空白不会触发导航；
 * - 页面只输出字符串，通用动作统一走事件委托；
 * - 账户菜单、齿轮与页面设置入口统一派发 window 的 open-settings 事件，
 *   由本文件挂载 settings/settings.ts 的弹窗，避免各组件直接耦合设置层。
 */

import { createSidebar } from "./state/sidebar.ts";
import {
  isDetailPage,
  navigate,
  parseRoute,
  routeHash,
  sameRoute,
} from "./state/navigation.ts";
import type { PageId, Route } from "./state/navigation.ts";
import { createTheme } from "./state/theme.ts";
import type { ResolvedTheme, ThemePreference } from "./state/theme.ts";

import { createTranslator, detectLanguage, isLanguage, LANGUAGE_STORAGE_KEY } from "./components/i18n.ts";
import type { Language, Translator } from "./components/i18n.ts";
import { iconSvg } from "./components/icons.ts";
import { PAGE_TITLE_KEYS } from "./components/navigation.ts";
import { renderSidebar } from "./components/sidebar.ts";
import { pickGreeting } from "./greeting.ts";
import {
  catForTime,
  makeClip,
  mascotSource,
  mascotStillSource,
  msUntilNextHour,
  pickClickAction,
} from "./components/mascot.ts";
import type { GreetingWeather } from "./greeting.ts";
import { gatewayApi, overviewApi, profilesApi, providersApi, usageApi } from "./api/core.ts";
import type {
  ModelEntry as ModelEntryDto,
  ModelInput,
  ProfileDetail as ProfileDetailDto,
  ProfileSummary,
  ProviderDetail as ProviderDetailDto,
  ProviderSummary,
} from "../shared/ipc.ts";
import { createLanguageModal } from "./components/language-modal.ts";
import { createConfirmDialog } from "./components/confirm-dialog.ts";
import type { ConfirmDialogOptions } from "./components/confirm-dialog.ts";
import { showFloatingNotice } from "./components/floating-notice.ts";
import { trapFocus } from "./components/focus-trap.ts";
import {
  persistUserAvatar,
  persistUserName,
  readUserIdentity,
} from "./state/user-identity.ts";
import {
  OPEN_SETTINGS_EVENT,
  dispatchOpenSettings,
  normalizeClientInfo,
  normalizeOpenSettingsDetail,
  normalizeSettingsSection,
} from "./components/events.ts";
import type { ClientInfo, OpenSettingsDetail } from "./components/events.ts";
import {
  ACTION_SELECTOR,
  isShellContainer,
  nextSortDirection,
  resolvePageExport,
  toggleAriaChecked,
} from "./components/ui-actions.ts";

import { render as renderOverview } from "./pages/overview.ts";
import { PROVIDER_CREATE_ID, render as renderProviders } from "./pages/providers.ts";
import * as providersModule from "./pages/providers.ts";
import {
  PROFILE_CREATE_ID,
  render as renderProfiles,
  renderAddModelEntry,
} from "./pages/profiles.ts";
import type {
  ProfileDraft,
  ProfileModelDraft,
  ProfilesDemo,
  ProviderOption,
} from "./pages/profiles.ts";
import * as profilesModule from "./pages/profiles.ts";
import { buildUsageViewData, render as renderUsage } from "./pages/usage.ts";
import * as usageModule from "./pages/usage.ts";
import type { PageContext } from "./pages/types.ts";

import { createSettingsModal } from "./settings/settings.ts";
import type { SettingsTheme } from "./settings/settings.ts";

interface ClaudeHarborBridge {
  getUsername?(): string;
  getTheme?(): Promise<unknown>;
  setTheme?(mode: ThemePreference): Promise<unknown>;
  onThemeChange?(callback: (theme: ResolvedTheme) => void): (() => void) | void;
  clientInfo?: ClientInfo;
  getClientInfo?(): ClientInfo | Promise<ClientInfo>;
  openSettings?(detail: OpenSettingsDetail): void;
  pickUsageProfileFile?(): Promise<string | null>;
  pickAvatarFile?(): Promise<string | null>;
  getWeather?(): Promise<GreetingWeather | null>;
  system?: {
    get?(): Promise<{ launchAtLogin?: boolean; backgroundOnClose?: boolean }>;
    setLaunchAtLogin?(value: boolean): Promise<boolean>;
    setBackgroundOnClose?(value: boolean): Promise<boolean>;
  };
}

declare global {
  interface Window {
    claudeHarbor?: ClaudeHarborBridge;
  }
}

interface DetailRenderer {
  (context: PageContext, id: string, detail?: unknown, providers?: unknown): unknown;
}

type FieldModalFactory = (options?: {
  language?: Language;
  onAdd?: (field: { key: string; value: string }) => void;
  onClose?: () => void;
}) => unknown;

interface HeatmapRenderer {
  (range: string): unknown;
}

const PAGE_RENDERERS: Record<PageId, (context: PageContext) => string> = {
  overview: renderOverview,
  providers: renderProviders,
  profiles: renderProfiles,
  usage: renderUsage,
};

/**
 * 页面模块的详情/弹窗/热力图扩展是可选的：页面未提供时，路由回落到列表，
 * 通用动作安静 no-op，shell 不会白屏。
 */
const DETAIL_RENDERERS: Readonly<Partial<Record<PageId, DetailRenderer | null>>> = {
  providers: resolvePageExport<DetailRenderer>(providersModule, "renderDetail"),
  profiles: resolvePageExport<DetailRenderer>(profilesModule, "renderDetail"),
};

const createFieldModal = resolvePageExport<FieldModalFactory>(
  profilesModule,
  "createFieldModal",
);

const renderHeatmap = resolvePageExport<HeatmapRenderer>(usageModule, "renderHeatmap");

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Shipcat renderer root #app is missing");

root.innerHTML = `<div class="app-shell" data-sidebar="collapsed">
  <header class="titlebar" data-drag-region data-role="titlebar"></header>
  <button
    type="button"
    class="sidebar-toggle"
    data-action="toggle-sidebar"
    aria-controls="app-sidebar"
    aria-expanded="false"
    aria-pressed="false"
    aria-label="Toggle sidebar"
  >${iconSvg("sidebar", "toggle-icon")}</button>
  <div class="sidebar-slot" id="sidebar-slot"></div>
  <main class="workspace" id="workspace"></main>
</div>`;

function must<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`Shipcat renderer is missing ${label}`);
  return value;
}

const shell = must(root.querySelector<HTMLElement>(".app-shell"), ".app-shell");
const sidebarSlot = must(root.querySelector<HTMLElement>("#sidebar-slot"), "#sidebar-slot");
const workspace = must(root.querySelector<HTMLElement>("#workspace"), "#workspace");
const toggleButton = must(
  root.querySelector<HTMLButtonElement>(".sidebar-toggle"),
  ".sidebar-toggle",
);

// 标题栏按钮直接绑定，避免悬浮层/拖拽区或事件委托的命中问题。
toggleButton.addEventListener("click", (event) => {
  event.stopPropagation();
  menuOpen = false;
  sidebar.toggle();
  renderSidebarView();
  syncChrome();
});

/** 事件委托作用于 #app，但 shell 容器本身只是布局节点，不是动作目标。 */
const SHELL_CONTAINERS = [root, shell, sidebarSlot, workspace] as const;

const bridge = window.claudeHarbor;
const sidebar = createSidebar();
const theme = createTheme();

let route: Route = parseRoute(window.location.hash);
let page: PageId = route.page;
let language: Language = readLanguage();
let translator: Translator = createTranslator(language);
let userIdentity = readUserIdentity();
let localClientInfo: ClientInfo = readClientInfo();
let clientInfo: ClientInfo = withCustomName(localClientInfo);
let menuOpen = false;
let settingsOverlay: HTMLElement | null = null;
let languageOverlay: HTMLElement | null = null;
let fieldModal: HTMLElement | null = null;
let disposeFieldTrap: (() => void) | null = null;
let fieldRestore: HTMLElement | null = null;
let confirmOverlay: HTMLElement | null = null;
let disposeConfirmTrap: (() => void) | null = null;
let disposeLanguageTrap: (() => void) | null = null;
let disposeThemeChange: (() => void) | void;
let disposeGatewayStatus: (() => void) | void;
let greetingWeather: GreetingWeather | null = null;
let greetingTimer: number | null = null;
let mascotTimer: number | null = null;
let systemSettings = { launchAtLogin: false, backgroundOnClose: false };

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */

if (window.location.hash !== routeHash(route)) {
  window.history.replaceState(null, "", routeHash(route));
}

applyTheme(theme.getResolved());
disposeThemeChange = bridge?.onThemeChange?.(applyTheme);
theme.subscribe((snapshot) => applyTheme(snapshot.resolved));

void bridge?.system?.get?.().then((value) => {
  if (!value) return;
  systemSettings = {
    launchAtLogin: Boolean(value.launchAtLogin),
    backgroundOnClose: Boolean(value.backgroundOnClose),
  };
}).catch(() => undefined);

function refreshWelcome(): void {
  if (page !== "overview") return;
  const greeting = workspace.querySelector<HTMLElement>(".ov-greeting");
  if (greeting) {
    greeting.textContent = pickGreeting({
      language,
      username: clientInfo.username,
      weather: greetingWeather,
    });
  }
}

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let mascotCat = 0;
let mascotPlaying = false;
let mascotStillTimer: number | null = null;

function mascotImage(): HTMLImageElement | null {
  return workspace.querySelector<HTMLImageElement>("[data-role=overview-mascot]");
}

function mascotButton(): HTMLElement | null {
  return workspace.querySelector<HTMLElement>("[data-role=overview-mascot-button]");
}

function showMascotStill(cat: number): void {
  const mascot = mascotImage();
  if (!mascot) return;
  mascot.dataset.clip = `cat-${cat}-still`;
  mascot.src = mascotStillSource(cat);
}

/** 播一次 GIF：先把 src 指回静态图，再挂动图，保证每次从第一帧开始只播一遍。 */
function playMascotAction(action: "blink" | "tail"): void {
  const mascot = mascotImage();
  if (!mascot || mascotPlaying) return;
  const clip = makeClip(mascotCat, action);
  mascotPlaying = true;
  mascot.dataset.clip = clip.id;
  mascot.src = mascotStillSource(clip.cat);
  window.setTimeout(() => {
    if (mascot.isConnected) mascot.src = mascotSource(clip);
  }, 16);
  if (mascotStillTimer !== null) window.clearTimeout(mascotStillTimer);
  mascotStillTimer = window.setTimeout(() => {
    mascotPlaying = false;
    showMascotStill(mascotCat);
  }, clip.durationMs + 30);
}

function handleMascotClick(): void {
  if (reduceMotion.matches || mascotPlaying) return;
  const action = pickClickAction();
  if (action !== null) playMascotAction(action);
}

function paintMascot(): void {
  if (mascotTimer !== null) {
    window.clearTimeout(mascotTimer);
    mascotTimer = null;
  }
  if (page !== "overview") return;

  const mascot = mascotImage();
  if (!mascot) return;

  const cat = catForTime();
  mascotCat = cat;
  if (!mascotPlaying) showMascotStill(cat);
  const button = mascotButton();
  if (button) button.onclick = handleMascotClick;

  mascotTimer = window.setTimeout(paintMascot, msUntilNextHour());
}

void bridge?.getWeather?.().then((weather) => {
  if (!weather) return;
  greetingWeather = weather;
  refreshWelcome();
}).catch(() => undefined);

greetingTimer = window.setInterval(refreshWelcome, 5 * 60_000);
paintMascot();

try {
  disposeGatewayStatus = (
    bridge as unknown as
      | { gateway?: { onStatus?: (callback: (status: unknown) => void) => () => void } }
      | undefined
  )?.gateway?.onStatus?.(() => {
    if (page === "overview" || page === "profiles") void renderWorkspace();
  });
} catch {
  // 浏览器预览或旧 preload 没有网关事件时忽略。
}

// 让原生窗口背景与已保存的偏好保持一致（主进程只在变化时广播）。
syncNativeTheme(theme.getPreference());
void loadClientInfoFromBridge();

renderSidebarView();
void renderWorkspace(true);
syncChrome();

sidebar.subscribe((state) => {
  const expanded = state.pinned || state.preview;
  if (!expanded && menuOpen) {
    menuOpen = false;
    renderSidebarView();
  }
  syncChrome();
});

/* ------------------------------------------------------------------ */
/* 侧栏：点击固定、悬停预览、移入面板后保持                              */
/* ------------------------------------------------------------------ */

toggleButton.addEventListener("pointerenter", () => sidebar.pointerEnter("trigger"));
toggleButton.addEventListener("pointerleave", () => sidebar.pointerLeave("trigger"));
sidebarSlot.addEventListener("pointerenter", () => sidebar.pointerEnter("panel"));
sidebarSlot.addEventListener("pointerleave", () => sidebar.pointerLeave("panel"));

/* ------------------------------------------------------------------ */
/* 事件委托                                                            */
/* ------------------------------------------------------------------ */

// 添加档案页：模式切换只在本页切换进阶字段的可见性。
workspace.addEventListener("change", (event) => {
  const target = event.target;

  if (target instanceof HTMLInputElement && target.dataset.role === "gateway-switch") {
    const bar = target.closest<HTMLElement>('[data-role="gateway-bar"]');
    const profileId = bar?.dataset.profileId;
    if (!profileId) return;
    void (async () => {
      try {
        if (target.checked) {
          await gatewayApi.start(profileId);
          showFloatingNotice({ title: "本地网关已开启", tone: "success" });
        } else {
          await gatewayApi.stop();
          showFloatingNotice({ title: "本地网关已暂停", tone: "info" });
        }
        await renderWorkspace();
      } catch (error) {
        target.checked = !target.checked;
        showFloatingNotice({
          title: "网关操作失败",
          message: error instanceof Error ? error.message : String(error),
          tone: "danger",
        });
      }
    })();
    return;
  }

  if (!(target instanceof HTMLSelectElement)) return;

  if (target.dataset.field === "provider") {
    const entry = target.closest<HTMLElement>('[data-role="profile-add-model-entry"]');
    const label = entry?.querySelector<HTMLElement>('[data-role="model-summary-provider"]');
    if (label) label.textContent = target.value;
    return;
  }

  if (target.dataset.role === "profile-mode") {
    const pageElement = workspace.querySelector<HTMLElement>('[data-role="page-profile-add"]');
    if (!pageElement) return;
    pageElement.dataset.mode = target.value === "advanced" ? "advanced" : "standard";
    return;
  }

  const entry = target.closest<HTMLElement>('[data-role="profile-add-model-entry"]');
  if (!entry) return;
  if (target.dataset.field === "anthropicFamilyTier") {
    const badge = entry.querySelector<HTMLElement>('[data-role="model-summary-tier"]');
    if (badge) {
      badge.textContent = target.value;
      badge.hidden = target.value.length === 0;
    }
  }
});

workspace.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.dataset.field !== "supports1m") return;
  const entry = target.closest<HTMLElement>('[data-role="profile-add-model-entry"]');
  const badge = entry?.querySelector<HTMLElement>('[data-role="model-summary-1m"]');
  if (badge) badge.hidden = !target.checked;
});

workspace.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.dataset.field !== "modelName") return;
  const entry = target.closest<HTMLElement>('[data-role="profile-add-model-entry"]');
  const name = entry?.querySelector<HTMLElement>('[data-role="model-summary-name"]');
  if (!entry || !name) return;
  name.textContent = target.value.trim() || entry.dataset.untitled || "";
});

root.addEventListener("click", (event) => {
  const target = event.target;
  // 图标是 SVG 时 target 不是 HTMLElement，委托必须按 Element 判断。
  if (!(target instanceof Element)) return;
  const candidate = target.closest<HTMLElement>(ACTION_SELECTOR);
  const actionable = isShellContainer(candidate, SHELL_CONTAINERS) ? null : candidate;

  if (!actionable) {
    if (target.closest(".sidebar")) pinPreview();
    if (menuOpen) closeMenu();
    closePageSearchUnless(target);
    return;
  }

  const action = actionable.dataset.action ?? "";
  const insideSidebar = actionable.closest(".sidebar") !== null;
  const insideMenu = actionable.closest(".account-menu") !== null;

  if (insideSidebar) pinPreview();
  if (menuOpen && !insideMenu && action !== "account") closeMenu();
  closePageSearchUnless(actionable);

  if (actionable.dataset.usageRange) {
    handleUsageRange(actionable);
    return;
  }

  if (actionable.dataset.route) {
    navigateRoute(parseRoute(actionable.dataset.route), false);
    return;
  }

  switch (action) {
    case "toggle-sidebar": {
      menuOpen = false;
      sidebar.toggle();
      renderSidebarView();
      syncChrome();
      return;
    }
    case "account": {
      menuOpen = !menuOpen;
      renderSidebarView();
      syncChrome();
      if (menuOpen) focusFirstMenuItem();
      return;
    }
    case "open-language": {
      openLanguageModal();
      return;
    }
    case "settings":
    case "learn-more": {
      const section = normalizeSettingsSection(
        actionable.dataset.section ?? (action === "learn-more" ? "client-info" : "general"),
      );
      if (menuOpen) closeMenu();
      dispatchOpenSettings({
        section,
        source: actionable.dataset.source ?? "renderer",
        clientInfo,
      });
      return;
    }
    case "toggle": {
      handleToggle(actionable);
      return;
    }
    case "search-toggle": {
      handleSearchToggle(actionable);
      return;
    }
    case "search-profiles":
    case "search-providers": {
      handleSearchToggle(actionable);
      return;
    }
    case "sort":
    case "sort-profiles":
    case "sort-providers": {
      handleSort(actionable);
      return;
    }
    case "remove-claude-field": {
      const profileId = route.detailId;
      const key = actionable.dataset.claudeKey;
      if (profileId && key) void removeClaudeField(profileId, key);
      return;
    }
    case "delete-profile": {
      const profileId = actionable.dataset.profileId?.trim() ?? route.detailId ?? "";
      const name = workspace.querySelector<HTMLElement>(".profile-detail-heading h1")?.textContent ?? "该档案";
      openConfirmDialog({
        title: "删除档案",
        message: `确定要删除「${name}」吗？已应用的档案需要先切换后再删除。`,
        confirmLabel: "删除",
        tone: "danger",
        onConfirm: () => {
          void (async () => {
            try {
              await profilesApi.remove(profileId);
              showFloatingNotice({ title: "已删除档案", tone: "success" });
              navigateRoute({ page: "profiles", detailId: null }, false);
            } catch (error) {
              showFloatingNotice({
                title: "删除档案失败",
                message: error instanceof Error ? error.message : String(error),
                tone: "danger",
              });
            }
          })();
        },
      });
      return;
    }
    case "add-profile-model": {
      appendAddModelEntry();
      return;
    }
    case "remove-profile-model": {
      event.preventDefault();
      const item = actionable.closest<HTMLElement>('[data-role="model-item"]');
      const profileId = route.detailId;
      const modelName = item?.dataset.originalName;
      if (!profileId || !modelName) return;
      void (async () => {
        try {
          await profilesApi.removeModel(profileId, modelName);
          showFloatingNotice({ title: "已移除模型", tone: "success" });
          await renderWorkspace();
        } catch (error) {
          showFloatingNotice({
            title: "移除模型失败",
            message: error instanceof Error ? error.message : String(error),
            tone: "danger",
          });
        }
      })();
      return;
    }
    case "remove-add-model": {
      event.preventDefault();
      const pageElement = workspace.querySelector<HTMLElement>('[data-role="page-profile-add"]');
      const entry = actionable.closest<HTMLElement>('[data-role="profile-add-model-entry"]');
      entry?.remove();
      const count = pageElement?.querySelectorAll('[data-role="profile-add-model-entry"]').length ?? 0;
      const counter = pageElement?.querySelector<HTMLElement>('[data-role="profile-add-model-count"]');
      if (counter) counter.textContent = `${count} ${language === "zh" ? "项" : "items"}`;
      return;
    }
    case "save-provider":
    case "create-provider": {
      void submitProviderForm(action === "create-provider");
      return;
    }
    case "save-profile":
    case "create-profile-submit": {
      void submitProfileForm(action === "create-profile-submit");
      return;
    }
    case "apply-profile": {
      const profileId = actionable.dataset.profileId?.trim();
      if (!profileId) return;
      void (async () => {
        try {
          await gatewayApi.stop();
          await profilesApi.apply(profileId);
          const name =
            actionable
              .closest<HTMLElement>(".profile-row")
              ?.querySelector<HTMLElement>(".profile-row-name")?.textContent ?? "该配置";
          showFloatingNotice({ title: `已应用「${name}」`, tone: "success" });
          await renderWorkspace();
        } catch (error) {
          showFloatingNotice({
            title: "应用档案失败",
            message: error instanceof Error ? error.message : String(error),
            tone: "danger",
          });
        }
      })();
      return;
    }
    case "delete-provider": {
      event.preventDefault();
      const name =
        workspace.querySelector<HTMLElement>(".pv-detail-head h1")?.textContent?.trim() ?? "该供应商";
      openConfirmDialog({
        title: "删除供应商",
        message: `确定要删除「${name}」吗？当前为原型阶段，确认后不会写入本机配置。`,
        confirmLabel: "删除",
        tone: "danger",
        onConfirm: () => {
          void (async () => {
            const id = actionable.dataset.providerId ?? route.detailId ?? "";
            try {
              await providersApi.remove(id);
              showFloatingNotice({ title: "已删除供应商", tone: "success" });
              navigateRoute({ page: "providers", detailId: null }, false);
            } catch (error) {
              showFloatingNotice({
                title: "删除供应商失败",
                message: error instanceof Error ? error.message : String(error),
                tone: "danger",
              });
            }
          })();
        },
        onClose: () => {
          actionable.focus();
        },
      });
      return;
    }
    case "gateway-start": {
      showFloatingNotice({
        title: "正在重试网关连接（原型）",
        message: "接入 core 后会展示真实的重试状态。",
        tone: "info",
      });
      return;
    }
    case "create-profile": {
      navigateRoute({ page: "profiles", detailId: PROFILE_CREATE_ID }, false);
      return;
    }
    case "add-field": {
      handleAddField(actionable);
      return;
    }
    case "add-provider": {
      navigateRoute({ page: "providers", detailId: PROVIDER_CREATE_ID }, false);
      return;
    }
    case "open-provider": {
      const providerId = actionable.dataset.providerId?.trim();
      if (providerId) {
        navigateRoute({ page: "providers", detailId: providerId }, false);
      }
      return;
    }
    case "open-profile": {
      const profileId = actionable.dataset.profileId?.trim();
      if (profileId) {
        navigateRoute({ page: "profiles", detailId: profileId }, false);
      }
      return;
    }
    case "profiles-back": {
      event.preventDefault();
      navigateRoute({ page: "profiles", detailId: null }, true);
      return;
    }
    case "navigate":
    default: {
      if (actionable.dataset.page) {
        const targetPage = navigate(actionable.dataset.page);
        const detailId = actionable.dataset.id?.trim() ?? "";
        const opensDetail = isDetailPage(targetPage) && detailId.length > 0;
        navigateRoute(
          {
            page: targetPage,
            detailId: opensDetail ? detailId : null,
          },
          !opensDetail,
        );
      }
      return;
    }
  }
});

// 键盘：⌘/Ctrl+B 切换侧栏，Esc 关闭弹窗/菜单/预览，菜单内上下键移动。
document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) return;
  const primary = event.metaKey || event.ctrlKey;

  if (event.key === "Escape" && fieldModal && !settingsOverlay) {
    event.preventDefault();
    closeFieldModal();
    return;
  }

  if (primary && event.key === ",") {
    event.preventDefault();
    if (!settingsOverlay) {
      dispatchOpenSettings({ section: "general", source: "shortcut", clientInfo });
    }
    return;
  }

  if (primary && /^[1-4]$/.test(event.key) && !settingsOverlay) {
    const target = (["overview", "providers", "profiles", "usage"] as const)[Number(event.key) - 1];
    if (target) {
      event.preventDefault();
      navigateRoute({ page: target, detailId: null }, true);
      return;
    }
  }

  if (primary && event.key.toLowerCase() === "b" && !settingsOverlay) {
    event.preventDefault();
    menuOpen = false;
    sidebar.toggle();
    renderSidebarView();
    syncChrome();
    return;
  }

  if (event.key === "Escape" && !settingsOverlay) {
    if (closeSortMenu()) {
      event.preventDefault();
      return;
    }
    if (menuOpen) {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    const state = sidebar.getState();
    if (state.preview) {
      event.preventDefault();
      sidebar.pointerLeave("panel");
      sidebar.pointerLeave("trigger");
    }
  }
});

sidebarSlot.addEventListener("keydown", (event) => {
  if (!menuOpen || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
  const items = [...sidebarSlot.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')];
  if (items.length === 0) return;
  event.preventDefault();
  const active = document.activeElement;
  const index = items.indexOf(active as HTMLElement);
  const delta = event.key === "ArrowDown" ? 1 : -1;
  const next = index === -1 ? (delta > 0 ? 0 : items.length - 1) : (index + delta + items.length) % items.length;
  items[next]?.focus();
});

document.addEventListener("focusin", (event) => {
  if (!menuOpen) return;
  const target = event.target;
  if (target instanceof Element && !target.closest(".account-wrap")) closeMenu();
});

window.addEventListener(OPEN_SETTINGS_EVENT, (event) => {
  openSettings(normalizeOpenSettingsDetail((event as CustomEvent).detail));
});

// 设置层与语言切换都可能广播客户端信息；这里只采用显式给出的字段。
window.addEventListener("client-info", (event) => {
  const next = normalizeClientInfo((event as CustomEvent).detail);
  if (Object.keys(next).length === 0) return;
  localClientInfo = { ...localClientInfo, ...next };
  clientInfo = withCustomName(localClientInfo);
  renderSidebarView();
});

window.addEventListener("language-change", (event) => {
  const detail = (event as CustomEvent).detail as { language?: unknown } | null;
  if (detail && isLanguage(detail.language) && detail.language !== language) {
    setLanguage(detail.language);
  }
});

window.addEventListener("hashchange", () => {
  const next = parseRoute(window.location.hash);
  if (sameRoute(next, route)) return;
  route = next;
  page = next.page;
  menuOpen = false;
  closeFieldModal();
  renderSidebarView();
  void renderWorkspace(true);
  syncChrome();
});

window.addEventListener("beforeunload", () => {
  theme.dispose();
  if (typeof disposeThemeChange === "function") disposeThemeChange();
  if (typeof disposeGatewayStatus === "function") disposeGatewayStatus();
  if (greetingTimer !== null) window.clearInterval(greetingTimer);
  if (mascotTimer !== null) window.clearTimeout(mascotTimer);
  closeFieldModal();
  disposeLanguageTrap?.();
  disposeLanguageTrap = null;
  languageOverlay?.remove();
  languageOverlay = null;
  sidebar.dispose();
});

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

function renderSidebarView(): void {
  sidebarSlot.innerHTML = renderSidebar({
    t: translator,
    page,
    language,
    menuOpen,
    clientInfo,
    avatar: userIdentity.avatar,
  });
}

async function renderWorkspace(resetScroll = false): Promise<void> {
  // 容器状态只写 data-view-*；data-page / data-usage-range 等是动作标识，
  // 一旦挂在容器上，点击空白就会命中事件委托并重渲染整页。
  workspace.dataset.viewPage = page;
  if (route.detailId) {
    workspace.dataset.viewDetail = route.detailId;
  } else {
    workspace.removeAttribute("data-view-detail");
  }

  workspace.innerHTML = await renderPageContent({
    t: translator,
    language,
    clientInfo,
  });
  if (resetScroll) workspace.scrollTop = 0;
  paintMascot();
}

function providerView(provider: ProviderSummary): {
  id: string;
  name: string;
  inferenceGatewayBaseUrl: string;
  inferenceGatewayAuthScheme: "x-api-key" | "bearer";
} {
  return {
    id: provider.id,
    name: provider.name,
    inferenceGatewayBaseUrl: provider.baseUrl,
    inferenceGatewayAuthScheme: provider.scheme,
  };
}

function providerPageDetail(provider: ProviderDetailDto): {
  id: string;
  name: string;
  inferenceGatewayBaseUrl: string;
  inferenceGatewayAuthScheme: "x-api-key" | "bearer";
  inferenceGatewayApiKey: string;
} {
  return { ...providerView(provider), inferenceGatewayApiKey: provider.apiKey };
}

async function renderProvidersPage(context: PageContext, detailId: string | null): Promise<string> {
  const renderer = DETAIL_RENDERERS.providers;
  try {
    if (detailId !== null && detailId !== PROVIDER_CREATE_ID && renderer) {
      const detail = await providersApi.get(detailId);
      const html = renderer(context, detailId, providerPageDetail(detail));
      if (typeof html === "string" && html.trim().length > 0) return html;
    }
    if (detailId === PROVIDER_CREATE_ID && renderer) {
      const html = renderer(context, detailId);
      if (typeof html === "string" && html.trim().length > 0) return html;
    }
    const providers = await providersApi.list();
    return renderProviders(context, { providers: providers.map(providerView) });
  } catch (error) {
    showFloatingNotice({
      title: "读取供应商失败",
      message: error instanceof Error ? error.message : String(error),
      tone: "danger",
    });
    if (detailId !== null && renderer) {
      const html = renderer(context, detailId);
      if (typeof html === "string" && html.trim().length > 0) return html;
    }
    return renderProviders(context, { providers: [] });
  }
}

function profileModelDraft(model: ModelEntryDto): ProfileModelDraft {
  return {
    name: model.name,
    ...(model.labelOverride === undefined ? {} : { labelOverride: model.labelOverride }),
    ...(model.supports1m === undefined ? {} : { supports1m: model.supports1m }),
    ...(model.prefer1m === undefined ? {} : { prefer1m: model.prefer1m }),
    ...(model.anthropicFamilyTier === undefined
      ? {}
      : { anthropicFamilyTier: model.anthropicFamilyTier as ProfileModelDraft["anthropicFamilyTier"] }),
    ...(model.isFamilyDefault === undefined ? {} : { isFamilyDefault: model.isFamilyDefault }),
    ...(model.behavesAs === undefined ? {} : { behavesAs: model.behavesAs }),
    ...(model.maxEffort === undefined
      ? {}
      : { maxEffort: model.maxEffort as ProfileModelDraft["maxEffort"] }),
    ...(model.provider === undefined ? {} : { provider: model.provider }),
    ...(model.providerName === undefined ? {} : { providerName: model.providerName }),
    ...(model.upstreamModel === undefined ? {} : { upstreamModel: model.upstreamModel }),
  };
}

function profileDraft(summary: ProfileSummary, detail?: ProfileDetailDto): ProfileDraft {
  return {
    id: summary.id,
    name: summary.name,
    mode: summary.mode,
    applied: summary.applied,
    ...(summary.port === undefined ? {} : { port: summary.port }),
    ...(detail?.gatewayToken === undefined ? {} : { gatewayToken: detail.gatewayToken }),
    ...(detail?.gatewayAuthScheme === undefined
      ? {}
      : { gatewayAuthScheme: detail.gatewayAuthScheme }),
    models: (detail?.models ?? []).map(profileModelDraft),
    ...(detail?.claude === undefined ? {} : { claude: detail.claude }),
  };
}

function providerOptions(providers: readonly ProviderSummary[]): ProviderOption[] {
  return providers.map((provider) => ({ id: provider.id, name: provider.name }));
}

async function renderProfilesPage(context: PageContext, detailId: string | null): Promise<string> {
  const renderer = DETAIL_RENDERERS.profiles;
  try {
    const summaries = await profilesApi.list();
    const providers = await providersApi.list();
    const options = providerOptions(providers);
    profileProviderCache = options;
    const gateway = await gatewayApi.status();
    const activeId = summaries.find((item) => item.applied)?.id ?? null;

    if (detailId === PROFILE_CREATE_ID && renderer) {
      const data: ProfilesDemo = { activeId, gatewayEnabled: gateway.running, profiles: [], providers: options };
      const html = renderer(context, detailId, data, options);
      if (typeof html === "string" && html.trim().length > 0) return html;
    }

    if (detailId !== null && detailId !== PROFILE_CREATE_ID && renderer) {
      const detail = await profilesApi.get(detailId);
      const summary = summaries.find((item) => item.id === detailId) ?? {
        id: detail.id,
        name: detail.name,
        mode: detail.mode,
        applied: detail.applied,
        modelCount: detail.modelCount,
        ...(detail.port === undefined ? {} : { port: detail.port }),
      };
      const data: ProfilesDemo = {
        activeId,
        gatewayEnabled: gateway.running,
        profiles: [profileDraft(summary, detail)],
        providers: options,
      };
      const html = renderer(context, detailId, data, options);
      if (typeof html === "string" && html.trim().length > 0) return html;
    }

    const activeDetail = activeId ? await profilesApi.get(activeId) : null;
    const data: ProfilesDemo = {
      activeId,
      gatewayEnabled: gateway.running,
      profiles: summaries.map((summary) =>
        profileDraft(summary, summary.id === activeId ? activeDetail ?? undefined : undefined),
      ),
      providers: options,
    };
    return renderProfiles(context, data);
  } catch (error) {
    showFloatingNotice({
      title: "读取档案失败",
      message: error instanceof Error ? error.message : String(error),
      tone: "danger",
    });
    return renderProfiles(context, { activeId: null, gatewayEnabled: false, profiles: [] });
  }
}

async function renderOverviewPage(context: PageContext): Promise<string> {
  try {
    const data = await overviewApi.get();
    return renderOverview({
      ...context,
      overview: {
        greeting: pickGreeting({
          language,
          username: clientInfo.username,
          weather: greetingWeather,
        }),
        activeProfile: data.activeProfile?.name ?? null,
        ...(data.activeProfile?.id === undefined ? {} : { activeProfileId: data.activeProfile.id }),
        mode: data.activeProfile?.mode === "advanced" ? "advanced" : "standard",
        gatewayEnabled: data.gateway.running,
        ...(data.gateway.error === undefined ? {} : { gatewayError: data.gateway.error }),
      },
    });
  } catch (error) {
    showFloatingNotice({
      title: "读取概览失败",
      message: error instanceof Error ? error.message : String(error),
      tone: "danger",
    });
    return renderOverview(context);
  }
}

async function renderUsagePage(context: PageContext): Promise<string> {
  const base = buildUsageViewData(context.language);
  try {
    const sync = await usageApi.sync();
    const ranges = ["30min", "1h", "1d"] as const;
    const buckets = await Promise.all(ranges.map((range) => usageApi.buckets(range)));
    const heatmap = Object.fromEntries(
      ranges.map((range, index) => [
        range,
        (buckets[index] ?? []).map((bucket) => ({
          at: new Date(bucket.start).toISOString(),
          value: bucket.value,
          level: bucket.level,
          label: bucket.label,
        })),
      ]),
    ) as Record<(typeof ranges)[number], { at: string; value: number | null; level: number; label: string }[]>;
    return renderUsage(context, {
      ...base,
      heatmap,
      demo: false,
      ledger: { lastSyncedAt: sync.lastSyncAt, recordCount: null },
    });
  } catch (error) {
    showFloatingNotice({
      title: "读取用量失败",
      message: error instanceof Error ? error.message : String(error),
      tone: "danger",
    });
    return renderUsage(context, { ...base, demo: false });
  }
}

async function renderPageContent(context: PageContext): Promise<string> {
  if (page === "overview") return renderOverviewPage(context);
  if (page === "providers") return renderProvidersPage(context, route.detailId);
  if (page === "profiles") return renderProfilesPage(context, route.detailId);
  if (page === "usage") return renderUsagePage(context);

  return renderOverview(context);
}

function syncChrome(): void {
  const state = sidebar.getState();
  const expanded = state.pinned || state.preview;
  const mode = state.pinned ? "pinned" : state.preview ? "preview" : "collapsed";

  shell.dataset.sidebar = mode;
  toggleButton.setAttribute("aria-expanded", String(expanded));
  toggleButton.setAttribute("aria-pressed", String(state.pinned));
  toggleButton.setAttribute("aria-label", translator.t("sidebar.toggle"));
  toggleButton.title = state.pinned
    ? translator.t("sidebar.toggleTitle.pinned")
    : state.preview
      ? translator.t("sidebar.toggleTitle.preview")
      : translator.t("sidebar.toggleTitle.collapsed");

  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.documentElement.dataset.language = language;
  document.title = translator.t("app.documentTitle", {
    page: translator.t(PAGE_TITLE_KEYS[page]),
  });
}

/* ------------------------------------------------------------------ */
/* 页面通用动作                                                        */
/* ------------------------------------------------------------------ */

function handleToggle(actionable: HTMLElement): void {
  const control = actionable.matches('[role="switch"]')
    ? actionable
    : actionable.querySelector<HTMLElement>('[role="switch"]');
  if (!control) return;

  const checked = toggleAriaChecked(control.getAttribute("aria-checked"));
  control.setAttribute("aria-checked", checked);
  control.dataset.checked = checked;
  window.dispatchEvent(
    new CustomEvent("ui-toggle", {
      detail: { checked: checked === "true", target: control, source: actionable },
    }),
  );
}

function handleSearchToggle(actionable: HTMLElement): void {
  const container = workspace.querySelector<HTMLElement>('[data-role="page-search"]');
  if (!container) return;

  if (actionable.dataset.action === "search-toggle") {
    setPageSearchOpen(false);
    return;
  }
  if (container.dataset.open !== "true") setPageSearchOpen(true);
}

function setPageSearchOpen(open: boolean): void {
  const container = workspace.querySelector<HTMLElement>('[data-role="page-search"]');
  if (!container) return;
  container.dataset.open = String(open);
  workspace.dataset.viewSearch = open ? "open" : "closed";

  const input = container.querySelector<HTMLInputElement>("input");
  if (open) {
    requestAnimationFrame(() => input?.focus());
  } else {
    input?.blur();
  }
}

/** 点在搜索框以外的空白或其他动作上时收起；点击发生在搜索框内部则保持展开。 */
function closePageSearchUnless(target: unknown): void {
  const container = workspace.querySelector<HTMLElement>('[data-role="page-search"]');
  if (!container || container.dataset.open !== "true") return;
  if (target instanceof Element && target.closest('[data-role="page-search"]')) return;
  setPageSearchOpen(false);
}

function handleSort(actionable: HTMLElement): void {
  const direction = nextSortDirection(
    actionable.dataset.sortDirection ?? workspace.dataset.viewSortDirection ?? null,
  );
  actionable.dataset.sortDirection = direction;
  workspace.dataset.viewSortDirection = direction;

  const key = actionable.dataset.sortKey?.trim();
  if (key) workspace.dataset.viewSortKey = key;

  const header = actionable.closest<HTMLElement>("th");
  if (header) {
    header.setAttribute("aria-sort", direction === "asc" ? "ascending" : "descending");
  }

  for (const item of workspace.querySelectorAll<HTMLElement>('[data-action="sort"]')) {
    item.classList.toggle("is-active", item === actionable);
    if (item !== actionable) delete item.dataset.sortDirection;
  }

  const menu = findSortMenu(actionable);
  if (!menu) return;
  const open = menu.hidden || menu.dataset.open !== "true";
  menu.hidden = !open;
  menu.dataset.open = String(open);
  actionable.setAttribute("aria-expanded", String(open));
  if (open) {
    requestAnimationFrame(() => {
      menu
        .querySelector<HTMLElement>('[role="menuitem"], [data-sort-option], button')
        ?.focus();
    });
  }
}

function findSortMenu(actionable: HTMLElement): HTMLElement | null {
  const hint = actionable.dataset.sortMenu?.trim();
  if (hint) {
    if (hint.startsWith("#")) return workspace.querySelector<HTMLElement>(hint);
    if (hint.startsWith(".") || hint.startsWith("[")) {
      try {
        return workspace.querySelector<HTMLElement>(hint);
      } catch {
        return null;
      }
    }
    return workspace.querySelector<HTMLElement>(`#${escapeSelector(hint)}`);
  }
  return (
    actionable
      .closest<HTMLElement>(".sort-wrap, [data-sort-wrap]")
      ?.querySelector<HTMLElement>('[data-role="sort-menu"], .sort-menu') ?? null
  );
}

function closeSortMenu(): boolean {
  const menu = workspace.querySelector<HTMLElement>(
    '[data-role="sort-menu"][data-open="true"], .sort-menu[data-open="true"]',
  );
  if (!menu) return false;
  menu.hidden = true;
  menu.dataset.open = "false";
  return true;
}

function handleAddField(trigger?: HTMLElement): void {
  closeFieldModal();
  if (!createFieldModal) return;
  const profileId = route.detailId;
  if (!profileId) return;

  let created: unknown;
  try {
    created = createFieldModal({
      language,
      onAdd: (field) => {
        void addClaudeField(profileId, field);
      },
    });
  } catch {
    return;
  }

  const node = toModalNode(created);
  if (!node) return;

  node.dataset.modal = "field";
  fieldModal = node;
  fieldRestore = trigger ?? null;
  document.body.appendChild(node);
  disposeFieldTrap = trapFocus(node, { initialFocus: '[data-role="field-key"]' });
}

function toModalNode(value: unknown): HTMLElement | null {
  if (value === null || value === undefined) return null;
  if (value instanceof HTMLElement) return value;
  if (typeof value === "string") {
    const host = document.createElement("div");
    host.className = "modal-host";
    host.innerHTML = value;
    return host;
  }
  if (value instanceof Node) {
    const host = document.createElement("div");
    host.className = "modal-host";
    host.appendChild(value);
    return host;
  }
  return null;
}

function closeFieldModal(): void {
  disposeFieldTrap?.();
  disposeFieldTrap = null;
  if (fieldModal && !fieldModal.isConnected) {
    fieldModal = null;
    fieldRestore = null;
    return;
  }
  fieldModal?.remove();
  fieldModal = null;
  const restore = fieldRestore;
  fieldRestore = null;
  restore?.focus();
}

function handleUsageRange(button: HTMLElement): void {
  const range = button.dataset.usageRange?.trim();
  if (!range) return;

  workspace.dataset.viewUsageRange = range;
  for (const item of workspace.querySelectorAll<HTMLElement>("[data-usage-range]")) {
    const active = item.dataset.usageRange === range;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-pressed", String(active));
  }

  // usage 页面自己持有热力图数据与 document 级区间监听；shell 不重复渲染。
  if (workspace.querySelector<HTMLElement>('[data-role="usage-heatmap-host"]')) return;

  const container = workspace.querySelector<HTMLElement>(
    '[data-usage-heatmap], [data-role="usage-heatmap"], .usage-heatmap',
  );
  if (!container) return;

  const output = renderHeatmap?.(range);
  if (typeof output === "string") {
    container.innerHTML = output;
  } else if (output instanceof Node) {
    container.replaceChildren(output);
  }
  container.dataset.range = range;
}

function escapeSelector(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^\w-]/g, (character) => `\\${character}`);
}

/* ------------------------------------------------------------------ */
/* 动作                                                                */
/* ------------------------------------------------------------------ */

function pinPreview(): void {
  const state = sidebar.getState();
  if (!state.pinned && state.preview) {
    sidebar.toggle();
    syncChrome();
  }
}

function navigateRoute(next: Route, focusNav: boolean): void {
  // 先经 routeHash + parseRoute 归一，保证非法详情 id 不会进入渲染。
  const normalized = parseRoute(routeHash(next));
  route = normalized;
  page = normalized.page;
  menuOpen = false;
  closeFieldModal();

  const hash = routeHash(route);
  if (window.location.hash !== hash) {
    window.history.replaceState(null, "", hash);
  }

  renderSidebarView();
  void renderWorkspace(true);
  syncChrome();
  if (focusNav) {
    requestAnimationFrame(() => {
      sidebarSlot.querySelector<HTMLElement>(`.nav-item[data-page="${page}"]`)?.focus();
    });
  }
}

function closeMenu(restoreFocus = false): void {
  if (!menuOpen) return;
  menuOpen = false;
  renderSidebarView();
  if (restoreFocus) {
    requestAnimationFrame(() => {
      sidebarSlot.querySelector<HTMLElement>('[data-action="account"]')?.focus();
    });
  }
}

function focusFirstMenuItem(): void {
  requestAnimationFrame(() => {
    sidebarSlot.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  });
}

function setLanguage(value: unknown): void {
  if (!isLanguage(value) || value === language) return;
  language = value;
  translator = createTranslator(language);
  persistLanguage(language);
  renderSidebarView();
  void renderWorkspace();
  syncChrome();
  disposeLanguageTrap?.();
  disposeLanguageTrap = null;
  languageOverlay?.remove();
  languageOverlay = null;
  window.dispatchEvent(new CustomEvent("language-change", { detail: { language } }));
}

/** 语言选择弹窗：菜单只负责打开，具体选项在弹窗里选择。 */
function openLanguageModal(): void {
  if (languageOverlay) return;
  closeMenu();
  const overlay = createLanguageModal({
    language,
    onSelect: (value) => setLanguage(value),
    onClose: () => {
      disposeLanguageTrap?.();
      disposeLanguageTrap = null;
      if (languageOverlay === overlay) languageOverlay = null;
      requestAnimationFrame(() => {
        sidebarSlot.querySelector<HTMLElement>('[data-action="account"]')?.focus();
      });
    },
  });
  overlay.dataset.theme = theme.getResolved();
  languageOverlay = overlay;
  document.body.appendChild(overlay);
  disposeLanguageTrap = trapFocus(overlay, { initialFocus: ".lang-option.is-selected" });
}

/** 自定义用户名优先；留空时回退到本机用户名。 */
function withCustomName(info: ClientInfo): ClientInfo {
  const name = userIdentity.name.trim();
  return name.length > 0 ? { ...info, username: name } : info;
}

function updateUserName(name: string): void {
  userIdentity = { ...userIdentity, name };
  persistUserName(name);
  clientInfo = withCustomName(localClientInfo);
  renderSidebarView();
  if (page === "overview") void renderWorkspace();
}

function updateUserAvatar(avatar: string): void {
  userIdentity = { ...userIdentity, avatar };
  persistUserAvatar(avatar);
  renderSidebarView();
}

function readModelForm(scope: HTMLElement): ModelInput {
  const input = (field: string): HTMLInputElement | HTMLSelectElement | null =>
    scope.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${field}"]`);
  const checked = (field: string): boolean =>
    scope.querySelector<HTMLInputElement>(`[data-field="${field}"]`)?.checked ?? false;
  return {
    name: input("modelName")?.value.trim() ?? "",
    labelOverride: input("labelOverride")?.value.trim() || undefined,
    supports1m: checked("supports1m"),
    prefer1m: checked("prefer1m"),
    anthropicFamilyTier: input("anthropicFamilyTier")?.value || undefined,
    isFamilyDefault: checked("isFamilyDefault"),
    behavesAs: input("behavesAs")?.value.trim() || undefined,
    maxEffort: input("maxEffort")?.value || undefined,
    provider: input("provider")?.value || undefined,
    upstreamModel: input("upstreamModel")?.value.trim() || undefined,
  };
}

async function submitProfileForm(creating: boolean): Promise<void> {
  try {
    if (creating) {
      const page = workspace.querySelector<HTMLElement>('[data-role="page-profile-add"]');
      if (!page) return;
      const name = page.querySelector<HTMLInputElement>('[data-field="name"]')?.value.trim() ?? "";
      const modeValue = page.querySelector<HTMLSelectElement>('[data-role="profile-mode"]')?.value;
      const mode = modeValue === "advanced" ? "advanced" : "standard";
      const portRaw = page.querySelector<HTMLInputElement>('[data-field="port"]')?.value.trim() ?? "";
      const token = page.querySelector<HTMLInputElement>('[data-field="gatewayToken"]')?.value ?? "";
      const gatewayAuthScheme =
        (page.querySelector<HTMLSelectElement>('[data-field="gatewayAuthScheme"]')?.value as
          | "x-api-key"
          | "bearer"
          | undefined) ?? "bearer";
      const models = [...page.querySelectorAll<HTMLElement>('[data-role="profile-add-model-entry"]')].map(
        readModelForm,
      );
      const created = await profilesApi.create({
        name,
        mode,
        models,
        ...(mode === "advanced" ? { gatewayToken: token, gatewayAuthScheme } : {}),
        ...(mode === "advanced" && portRaw.length > 0 ? { port: Number(portRaw) } : {}),
      });
      showFloatingNotice({ title: "已添加档案", tone: "success" });
      navigateRoute({ page: "profiles", detailId: created.id }, false);
      return;
    }

    const profileId = route.detailId;
    const page = workspace.querySelector<HTMLElement>('[data-role="page-profile-detail"]');
    if (!profileId || !page) return;
    if (page.dataset.mode === "advanced") {
      const portRaw = page.querySelector<HTMLInputElement>('[data-field="port"]')?.value.trim() ?? "";
      const gatewayToken = page.querySelector<HTMLInputElement>('[data-field="gatewayToken"]')?.value ?? "";
      const gatewayAuthScheme =
        (page.querySelector<HTMLSelectElement>('[data-field="gatewayAuthScheme"]')?.value as
          | "x-api-key"
          | "bearer"
          | undefined) ?? "bearer";
      await profilesApi.update(profileId, {
        ...(portRaw.length > 0 ? { port: Number(portRaw) } : {}),
        ...(gatewayToken.length > 0 ? { gatewayToken } : {}),
        gatewayAuthScheme,
      });
    }
    for (const item of workspace.querySelectorAll<HTMLElement>('[data-role="model-item"]')) {
      const previousName = item.dataset.originalName;
      if (!previousName) continue;
      const model = readModelForm(item);
      await profilesApi.updateModel(profileId, previousName, model);
    }
    showFloatingNotice({ title: "已保存档案", tone: "success" });
    await renderWorkspace();
  } catch (error) {
    showFloatingNotice({
      title: creating ? "添加档案失败" : "保存档案失败",
      message: error instanceof Error ? error.message : String(error),
      tone: "danger",
    });
  }
}

async function addClaudeField(profileId: string, field: { key: string; value: string }): Promise<void> {
  try {
    const detail = await profilesApi.get(profileId);
    await profilesApi.update(profileId, {
      claude: { ...(detail.claude ?? {}), [field.key]: field.value },
    });
    showFloatingNotice({ title: "已添加透传字段", tone: "success" });
    await renderWorkspace();
  } catch (error) {
    showFloatingNotice({
      title: "添加透传字段失败",
      message: error instanceof Error ? error.message : String(error),
      tone: "danger",
    });
  }
}

async function removeClaudeField(profileId: string, key: string): Promise<void> {
  try {
    const detail = await profilesApi.get(profileId);
    const next = { ...(detail.claude ?? {}) };
    delete next[key];
    await profilesApi.update(profileId, {
      claude: Object.keys(next).length === 0 ? null : next,
    });
    showFloatingNotice({ title: "已移除透传字段", tone: "success" });
    await renderWorkspace();
  } catch (error) {
    showFloatingNotice({
      title: "移除透传字段失败",
      message: error instanceof Error ? error.message : String(error),
      tone: "danger",
    });
  }
}

function readProviderForm(): { name: string; baseUrl: string; apiKey: string; scheme: "x-api-key" | "bearer" } {
  const name = workspace.querySelector<HTMLInputElement>("#pv-provider-name")?.value ?? "";
  const baseUrl = workspace.querySelector<HTMLInputElement>("#pv-provider-base-url")?.value ?? "";
  const apiKey = workspace.querySelector<HTMLInputElement>("#pv-provider-api-key")?.value ?? "";
  const checked = workspace.querySelector<HTMLInputElement>('input[name="inferenceGatewayAuthScheme"]:checked');
  const scheme = checked?.value === "bearer" ? "bearer" : "x-api-key";
  return { name, baseUrl, apiKey, scheme };
}

async function submitProviderForm(creating: boolean): Promise<void> {
  const form = readProviderForm();
  const id = route.detailId ?? "";
  try {
    if (creating) {
      const created = await providersApi.create(form);
      showFloatingNotice({ title: "已添加供应商", tone: "success" });
      navigateRoute({ page: "providers", detailId: created.id }, false);
    } else {
      await providersApi.update(id, form);
      showFloatingNotice({ title: "已保存供应商", tone: "success" });
      await renderWorkspace();
    }
  } catch (error) {
    showFloatingNotice({
      title: creating ? "添加供应商失败" : "保存供应商失败",
      message: error instanceof Error ? error.message : String(error),
      tone: "danger",
    });
  }
}

function openConfirmDialog(options: ConfirmDialogOptions): void {
  if (confirmOverlay) return;
  const overlay = createConfirmDialog({
    ...options,
    onClose: () => {
      disposeConfirmTrap?.();
      disposeConfirmTrap = null;
      confirmOverlay = null;
      options.onClose?.();
    },
  });
  overlay.dataset.theme = document.documentElement.dataset.theme ?? "light";
  confirmOverlay = overlay;
  document.body.appendChild(overlay);
  disposeConfirmTrap = trapFocus(overlay, { initialFocus: '[data-role="confirm-accept"]' });
}

let profileProviderCache: readonly ProviderOption[] = [];

function appendAddModelEntry(): void {
  const pageElement = workspace.querySelector<HTMLElement>('[data-role="page-profile-add"]');
  const list = pageElement?.querySelector<HTMLElement>('[data-role="profile-add-model-list"]');
  if (!list) return;
  const index = list.querySelectorAll('[data-role="profile-add-model-entry"]').length;
  list.insertAdjacentHTML("beforeend", renderAddModelEntry(index, language, profileProviderCache));
  const counter = pageElement?.querySelector<HTMLElement>('[data-role="profile-add-model-count"]');
  if (counter) {
    counter.textContent = `${index + 1} ${language === "zh" ? "项" : "items"}`;
  }
  list
    .querySelector<HTMLElement>(`[data-model-index="${index}"]`)
    ?.querySelector<HTMLInputElement>('[data-field="modelName"]')
    ?.focus();
}

function openSettings(detail: OpenSettingsDetail): void {
  settingsOverlay?.remove();
  settingsOverlay = null;

  const overlay = createSettingsModal({
    initialTheme: theme.getPreference(),
    initialSection: detail.section,
    clientInfo,
    launchAtLogin: systemSettings.launchAtLogin,
    backgroundOnClose: systemSettings.backgroundOnClose,
    onLaunchAtLoginChange: (value) => {
      systemSettings = { ...systemSettings, launchAtLogin: value };
      void bridge?.system?.setLaunchAtLogin?.(value);
    },
    onBackgroundOnCloseChange: (value) => {
      systemSettings = { ...systemSettings, backgroundOnClose: value };
      void bridge?.system?.setBackgroundOnClose?.(value);
    },
    customName: userIdentity.name,
    localUsername: localClientInfo.username ?? "",
    avatar: userIdentity.avatar,
    pickUsageProfileFile: () => bridge?.pickUsageProfileFile?.() ?? Promise.resolve(null),
    pickAvatarFile: () => bridge?.pickAvatarFile?.() ?? Promise.resolve(null),
    onUsernameChange: updateUserName,
    onAvatarChange: updateUserAvatar,
    onThemeChange: (mode: SettingsTheme) => {
      theme.setPreference(mode);
      overlay.dataset.theme = theme.getResolved();
      syncNativeTheme(mode);
    },
    onClose: () => {
      if (settingsOverlay === overlay) settingsOverlay = null;
    },
  });
  // 设置弹窗按自身 data-theme 解析颜色，显式同步一次，避免系统暗色覆盖应用内选择。
  overlay.dataset.theme = theme.getResolved();
  settingsOverlay = overlay;
  document.body.appendChild(overlay);
}

/* ------------------------------------------------------------------ */
/* 主题、语言、客户端信息                                               */
/* ------------------------------------------------------------------ */

function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
}

function syncNativeTheme(preference: ThemePreference): void {
  try {
    const pending = bridge?.setTheme?.(preference);
    if (pending && typeof pending.catch === "function") {
      void pending.catch(() => {
        // 没有主进程处理器时保持 DOM 主题即可。
      });
    }
  } catch {
    // 没有 preload（浏览器预览）时保持 DOM 主题即可。
  }
}

function readLanguage(): Language {
  try {
    const stored = globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // localStorage 不可用时跟随系统语言。
  }
  return detectLanguage(globalThis.navigator?.language);
}

function persistLanguage(value: Language): void {
  try {
    globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, value);
  } catch {
    // 忽略隐私模式下的写入失败。
  }
}

function readClientInfo(): ClientInfo {
  const base = normalizeClientInfo(bridge?.clientInfo);
  if (base.username) return base;
  try {
    const username = bridge?.getUsername?.();
    if (typeof username === "string" && username.trim().length > 0) {
      return { ...base, username: username.trim() };
    }
  } catch {
    // preload 不可用时只显示本地账户占位。
  }
  return base;
}

async function loadClientInfoFromBridge(): Promise<void> {
  if (typeof bridge?.getClientInfo !== "function") return;
  try {
    const next = normalizeClientInfo(await bridge.getClientInfo());
    if (Object.keys(next).length === 0) return;
    localClientInfo = { ...localClientInfo, ...next };
    clientInfo = withCustomName(localClientInfo);
    renderSidebarView();
  } catch {
    // 客户端信息只用于展示，读取失败不阻塞界面。
  }
}
