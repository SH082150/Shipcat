/**
 * Claude Desktop 风格的设置弹窗。
 *
 * 返回的根节点是遮罩层，内部是居中对话框；调用方把它挂到 body 即可。
 * 菜单包含常规 / 隐私 / 系统 / 关于四节；关于章节承载客户端信息，
 * client-info 深链自动映射到关于。常规页“了解更多”也进入关于。
 *
 * 除主题外，所有开关与选择器都只改本地 DOM 状态，不向上抛业务写入。
 * 主题变化只经 onThemeChange 上抛，由应用层决定如何持久化。
 * 样式由同目录 settings.css 提供，需由宿主的页面/构建自行引入。
 */

import type { ClientInfo } from "../components/events.ts";
import { iconSvg } from "../components/icons.ts";
import { createAvatarCropModal } from "./avatar-crop.ts";

export const SETTINGS_SECTIONS = ["general", "privacy", "usage", "system", "about"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number] | "client-info";

export type SettingsTheme = "light" | "dark" | "system";

/** 设置页展示的用量采集来源。 */
export interface UsageSourceOption {
  readonly id: string;
  readonly kind: string;
  readonly root: string | null;
  readonly resolvedRoot: string;
  readonly enabled: boolean;
}

export interface UsageSourcesSaveResult {
  readonly ok: boolean;
  readonly sources?: readonly UsageSourceOption[];
  readonly error?: string;
}

export type SettingsLanguage = "zh" | "en";

export interface SettingsModalOptions {
  /** 界面语言；文案表与页面其他模块保持一致。 */
  language: SettingsLanguage;
  /** 弹窗关闭（Esc、关闭按钮、点击遮罩）后调用，只回调一次。 */
  onClose: () => void;
  /** 主题选择变化时调用；初始渲染不触发。 */
  onThemeChange: (mode: SettingsTheme) => void;
  initialTheme: SettingsTheme;
  initialSection?: SettingsSection;
  clientInfo?: ClientInfo;
  /** 自定义用户名；空串表示未设置，界面回退到本机用户名。 */
  customName?: string;
  /** 本机用户名，用作输入框提示与提示。 */
  localUsername?: string;
  /** 自定义头像 data URL；空串表示未设置。 */
  avatar?: string;
  onUsernameChange?: (name: string) => void;
  onAvatarChange?: (avatar: string) => void;
  /** 选择头像图片，返回 data URL；取消返回 null。 */
  pickAvatarFile?: () => Promise<string | null>;
  launchAtLogin?: boolean;
  backgroundOnClose?: boolean;
  hideDock?: boolean;
  onLaunchAtLoginChange?: (value: boolean) => void;
  onBackgroundOnCloseChange?: (value: boolean) => void;
  onHideDockChange?: (value: boolean) => void;
  /** 用量采集来源；缺省为空列表。 */
  usageSources?: readonly UsageSourceOption[];
  /** 保存来源列表；返回最新列表或错误文案。 */
  onSaveUsageSources?: (
    sources: readonly UsageSourceOption[],
  ) => Promise<UsageSourcesSaveResult>;
  /** 选择目录；取消返回 null。 */
  pickUsageDirectory?: () => Promise<string | null>;
}

interface SettingsCopy {
  readonly title: string;
  readonly navLabel: string;
  readonly menu: Record<(typeof SETTINGS_SECTIONS)[number], string>;
  readonly sectionTitles: Record<SettingsSection, string>;
  readonly closeLabel: string;
  readonly appearanceTitle: string;
  readonly appearanceHint: string;
  readonly themeTitle: string;
  readonly themeHint: string;
  readonly themeAria: string;
  readonly themeOptions: Record<SettingsTheme, string>;
  readonly identityTitle: string;
  readonly identityHint: string;
  readonly nameTitle: string;
  readonly nameHint: string;
  readonly nameAria: string;
  readonly namePlaceholder: string;
  readonly avatarTitle: string;
  readonly avatarHint: string;
  readonly pickAvatar: string;
  readonly removeAvatar: string;
  readonly generalNote: string;
  readonly learnMore: string;
  readonly privacyTitle: string;
  readonly privacyHint: string;
  readonly privacyStatement: string;
  readonly storageTitle: string;
  readonly storageHint: string;
  readonly usageSourcesTitle: string;
  readonly usageSourcesHint: string;
  readonly usageDefaultLabel: string;
  readonly usageCustomLabel: string;
  readonly usageNoPath: string;
  readonly usagePickFolder: string;
  readonly usageRestoreAuto: string;
  readonly usageRemove: string;
  readonly usageAdd: string;
  readonly usageFootNote: string;
  readonly usageSaveError: string;
  readonly systemTitle: string;
  readonly systemHint: string;
  readonly versionTitle: string;
  readonly versionHint: string;
  readonly launchTitle: string;
  readonly launchHint: string;
  readonly backgroundTitle: string;
  readonly backgroundHint: string;
  readonly hideDockTitle: (isMac: boolean) => string;
  readonly hideDockHint: (isMac: boolean) => string;
  readonly aboutTitle: string;
  readonly aboutHint: string;
  readonly appNameLabel: string;
  readonly connectionLabel: string;
  readonly versionLabel: string;
  readonly licenseLabel: string;
  readonly localAccountLabel: string;
  readonly hostnameLabel: string;
  readonly connectionValue: string;
}

const SETTINGS_COPY: Record<SettingsLanguage, SettingsCopy> = {
  zh: {
    title: "设置",
    navLabel: "设置导航",
    menu: { general: "常规", privacy: "隐私", usage: "用量", system: "系统", about: "关于" },
    sectionTitles: { general: "常规", privacy: "隐私", usage: "用量", system: "系统", about: "关于", "client-info": "关于" },
    closeLabel: "关闭设置",
    appearanceTitle: "外观",
    appearanceHint: "调整 Shipcat 的外观，让它更适合你的工作环境。",
    themeTitle: "主题",
    themeHint: "选择浅色、深色，或跟随系统设置。",
    themeAria: "主题",
    themeOptions: { light: "浅色", dark: "深色", system: "系统" },
    identityTitle: "自定义",
    identityHint: "设置显示名称与头像；留空时使用本机信息。",
    nameTitle: "用户名",
    nameHint: "留空则显示本机用户名；设置后侧边栏与问候语都会使用自定义名称。",
    nameAria: "自定义用户名",
    namePlaceholder: "本机用户名",
    avatarTitle: "头像",
    avatarHint: "未设置时不显示头像；选择图片后立即生效。",
    pickAvatar: "选择图片",
    removeAvatar: "移除",
    generalNote: "Shipcat 通过本机网关连接 Claude Desktop。",
    learnMore: "了解更多",
    privacyTitle: "本地优先",
    privacyHint: "Shipcat 在你的设备上运行，默认不引入任何中转服务。",
    privacyStatement:
      "供应商与档案只保存在这台机器上。密钥不会上传，请求直接发送到你配置的上游服务。用量数据来自 Claude 在本机记录的用量。",
    storageTitle: "存储",
    storageHint: "管理本机的供应商、档案与用量数据。",
    usageSourcesTitle: "用量来源",
    usageSourcesHint: "选择 Shipcat 从哪里读取用量数据。默认会自动探测 Claude Desktop 的账本目录。",
    usageDefaultLabel: "Claude Desktop",
    usageCustomLabel: "自定义来源",
    usageNoPath: "未选择文件夹，暂不采集",
    usagePickFolder: "选择文件夹",
    usageRestoreAuto: "恢复自动",
    usageRemove: "移除",
    usageAdd: "添加来源",
    usageFootNote: "修改会立即保存并生效。",
    usageSaveError: "保存失败，请检查路径后重试。",
    systemTitle: "应用",
    systemHint: "当前安装的版本与启动方式。",
    versionTitle: "版本",
    versionHint: "Shipcat 桌面客户端的版本号。",
    launchTitle: "开机自启",
    launchHint: "登录系统后自动启动 Shipcat。",
    backgroundTitle: "关闭窗口后继续运行",
    backgroundHint: "关闭窗口时隐藏到后台，网关与统计继续工作。",
    hideDockTitle: (isMac) => (isMac ? "隐藏 Dock 图标" : "隐藏任务栏图标"),
    hideDockHint: (isMac) =>
      isMac
        ? "开启后应用只在菜单栏显示，关闭窗口时继续运行。"
        : "开启后应用只在托盘显示，关闭窗口时继续运行。",
    aboutTitle: "关于 Shipcat",
    aboutHint: "运行在这台设备上的 Shipcat 客户端信息。",
    appNameLabel: "应用名",
    connectionLabel: "连接方式",
    versionLabel: "版本",
    licenseLabel: "许可证",
    localAccountLabel: "本机账户",
    hostnameLabel: "主机名",
    connectionValue: "本地网关",
  },
  en: {
    title: "Settings",
    navLabel: "Settings navigation",
    menu: { general: "General", privacy: "Privacy", usage: "Usage", system: "System", about: "About" },
    sectionTitles: {
      general: "General",
      privacy: "Privacy",
      usage: "Usage",
      system: "System",
      about: "About",
      "client-info": "About",
    },
    closeLabel: "Close settings",
    appearanceTitle: "Appearance",
    appearanceHint: "Adjust how Shipcat looks to suit your workspace.",
    themeTitle: "Theme",
    themeHint: "Choose light, dark, or follow your system setting.",
    themeAria: "Theme",
    themeOptions: { light: "Light", dark: "Dark", system: "System" },
    identityTitle: "Personalization",
    identityHint: "Set a display name and avatar. Leave blank to use this device's info.",
    nameTitle: "Name",
    nameHint: "Leave blank to use your local username. When set, the sidebar and greeting use this name.",
    nameAria: "Custom username",
    namePlaceholder: "Local username",
    avatarTitle: "Avatar",
    avatarHint: "No avatar is shown when unset. Changes apply as soon as you pick an image.",
    pickAvatar: "Choose image",
    removeAvatar: "Remove",
    generalNote: "Shipcat connects to Claude Desktop through the local gateway.",
    learnMore: "Learn more",
    privacyTitle: "Local first",
    privacyHint: "Shipcat runs on your device and adds no intermediary services by default.",
    privacyStatement:
      "Providers and profiles stay on this machine. Keys are never uploaded; requests go directly to the upstream service you configure. Usage data comes from what Claude records locally.",
    storageTitle: "Storage",
    storageHint: "Manage providers, profiles, and usage data on this machine.",
    usageSourcesTitle: "Usage sources",
    usageSourcesHint:
      "Choose where Shipcat reads usage data. The Claude Desktop ledger is detected automatically by default.",
    usageDefaultLabel: "Claude Desktop",
    usageCustomLabel: "Custom source",
    usageNoPath: "No folder selected; nothing is collected",
    usagePickFolder: "Choose folder",
    usageRestoreAuto: "Restore automatic",
    usageRemove: "Remove",
    usageAdd: "Add source",
    usageFootNote: "Changes are saved and applied immediately.",
    usageSaveError: "Could not save. Check the folder path and try again.",
    systemTitle: "Application",
    systemHint: "Installed version and startup behavior.",
    versionTitle: "Version",
    versionHint: "The Shipcat desktop app version.",
    launchTitle: "Open at login",
    launchHint: "Start Shipcat automatically when you sign in.",
    backgroundTitle: "Keep running after closing the window",
    backgroundHint: "Hide to the background when the window closes so the gateway and usage tracking keep working.",
    hideDockTitle: (isMac) => (isMac ? "Hide Dock icon" : "Hide taskbar icon"),
    hideDockHint: (isMac) =>
      isMac
        ? "When enabled, Shipcat appears only in the menu bar and keeps running after the window closes."
        : "When enabled, Shipcat appears only in the system tray and keeps running after the window closes.",
    aboutTitle: "About Shipcat",
    aboutHint: "Shipcat client information on this device.",
    appNameLabel: "App",
    connectionLabel: "Connection",
    versionLabel: "Version",
    licenseLabel: "License",
    localAccountLabel: "Local account",
    hostnameLabel: "Hostname",
    connectionValue: "Local gateway",
  },
};

function copyFor(language: SettingsLanguage): SettingsCopy {
  return SETTINGS_COPY[language] ?? SETTINGS_COPY.en;
}

const APP_NAME = "Shipcat";
/** 与 package.json 的 version 保持一致；系统页与客户端信息页展示。 */
const APP_VERSION = "0.2.6";
const APP_LICENSE = "CC-BY-NC-SA-4.0";

const THEME_OPTIONS: readonly SettingsTheme[] = ["light", "dark", "system"];

let titleSeq = 0;

export function createSettingsModal(options: SettingsModalOptions): HTMLElement {
  const doc = document;
  const create = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
  ): HTMLElementTagNameMap[K] => {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    return element;
  };

  const copy = copyFor(options.language);
  const isMac = options.clientInfo?.platform === "darwin";
  let closed = false;
  let theme: SettingsTheme = options.initialTheme;
  let section: SettingsSection =
    options.initialSection === "client-info" ? "about" : (options.initialSection ?? "general");
  const previousFocus = doc.activeElement as HTMLElement | null;
  const titleId = `ch-settings-title-${++titleSeq}`;
  const appearanceId = `ch-settings-appearance-${titleSeq}`;
  const clientHeadId = `ch-settings-client-head-${titleSeq}`;

  const overlay = create("div", "ch-settings-overlay");
  overlay.setAttribute("data-role", "overlay");

  const dialog = create("div", "ch-settings");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", titleId);
  dialog.tabIndex = -1;
  overlay.appendChild(dialog);

  /* ------------------------------------------------------------------ */
  /* 侧栏：品牌标识 + 标题 + 五节菜单（不含版本号）                        */
  /* ------------------------------------------------------------------ */

  const sidebar = create("aside", "ch-settings-sidebar");
  sidebar.setAttribute("data-role", "sidebar");

  const sidebarHead = create("div", "ch-settings-sidebar-head");
  const brand = create("div", "ch-settings-brand");
  const brandLogo = create("span", "ch-settings-brand-logo");
  brandLogo.setAttribute("aria-hidden", "true");
  const brandMark = create("img", "ch-settings-brand-logo-img");
  brandMark.src = "./assets/mascots/cat-4-mark.png";
  brandMark.alt = "";
  brandMark.draggable = false;
  brandLogo.appendChild(brandMark);
  const brandName = create("span", "ch-settings-brand-name");
  brandName.textContent = APP_NAME;
  brand.append(brandLogo, brandName);

  const title = create("span", "ch-settings-title");
  title.id = titleId;
  title.setAttribute("data-role", "title");
  title.textContent = copy.title;
  sidebarHead.append(brand, title);
  sidebar.appendChild(sidebarHead);

  const nav = create("nav", "ch-settings-nav");
  nav.setAttribute("aria-label", copy.navLabel);
  const navButtons = new Map<(typeof SETTINGS_SECTIONS)[number], HTMLButtonElement>();
  for (const id of SETTINGS_SECTIONS) {
    const button = create("button", "ch-settings-nav-item");
    button.type = "button";
    button.tabIndex = 0;
    button.setAttribute("data-role", `nav-${id}`);
    button.setAttribute("data-section", id);
    button.setAttribute("aria-current", id === section ? "page" : "false");
    button.textContent = copy.menu[id];
    button.addEventListener("click", () => {
      if (section !== id) setSection(id);
    });
    navButtons.set(id, button);
    nav.appendChild(button);
  }
  sidebar.appendChild(nav);
  dialog.appendChild(sidebar);

  /* ------------------------------------------------------------------ */
  /* 主区域：页头 + 关闭按钮 + 章节容器                                    */
  /* ------------------------------------------------------------------ */

  const main = create("section", "ch-settings-main");
  const header = create("header", "ch-settings-header");
  const sectionTitle = create("h2", "ch-settings-section-title");
  sectionTitle.setAttribute("data-role", "section-title");
  sectionTitle.textContent = copy.sectionTitles[section];
  header.appendChild(sectionTitle);

  const closeButton = create("button", "ch-settings-close");
  closeButton.type = "button";
  closeButton.tabIndex = 0;
  closeButton.setAttribute("data-role", "close");
  closeButton.setAttribute("aria-label", copy.closeLabel);
  const closeGlyph = create("span", "ch-settings-close-glyph");
  closeGlyph.setAttribute("aria-hidden", "true");
  closeButton.appendChild(closeGlyph);
  header.appendChild(closeButton);
  main.appendChild(header);

  const body = create("div", "ch-settings-body");

  const createPane = (role: string): HTMLDivElement => {
    const pane = create("div", "ch-settings-pane");
    pane.setAttribute("data-role", role);
    pane.hidden = true;
    body.appendChild(pane);
    return pane;
  };

  const createSection = (pane: HTMLElement, role?: string): HTMLElement => {
    const block = create("section", "ch-settings-section");
    if (role) block.setAttribute("data-role", role);
    pane.appendChild(block);
    return block;
  };

  const createSectionHead = (
    parent: HTMLElement,
    headingText: string,
    hintText: string,
    headingId?: string,
  ): HTMLElement => {
    const head = create("div", "ch-settings-section-head");
    const heading = create("h3", "ch-settings-section-heading");
    if (headingId) heading.id = headingId;
    heading.textContent = headingText;
    const hint = create("p", "ch-settings-section-hint");
    hint.textContent = hintText;
    head.append(heading, hint);
    parent.appendChild(head);
    return head;
  };

  const createRow = (
    parent: HTMLElement,
    rowTitle: string,
    hintText: string,
    role?: string,
  ): { row: HTMLElement; main: HTMLElement; control: HTMLElement } => {
    const row = create("div", "ch-settings-row");
    if (role) row.setAttribute("data-role", role);
    const rowMain = create("div", "ch-settings-row-main");
    const heading = create("h4", "ch-settings-row-title");
    heading.textContent = rowTitle;
    const hint = create("p", "ch-settings-row-hint");
    hint.textContent = hintText;
    rowMain.append(heading, hint);
    const control = create("div", "ch-settings-row-control");
    row.append(rowMain, control);
    parent.appendChild(row);
    return { row, main: rowMain, control };
  };

  const createSwitch = (
    role: string,
    label: string,
    checked: boolean,
    onChange?: (value: boolean) => void,
  ): HTMLButtonElement => {
    const button = create("button", "ch-settings-switch");
    button.type = "button";
    button.tabIndex = 0;
    button.setAttribute("role", "switch");
    button.setAttribute("data-role", role);
    button.setAttribute("aria-label", label);
    let on = checked;
    const sync = (): void => {
      button.setAttribute("aria-checked", on ? "true" : "false");
    };
    sync();
    button.addEventListener("click", () => {
      on = !on;
      sync();
      onChange?.(on);
    });
    return button;
  };

  /* ------------------------------------------------------------------ */
  /* 常规：外观无外框，保留三主题卡片                                      */
  /* ------------------------------------------------------------------ */

  const generalPane = createPane("pane-general");
  const appearanceGroup = createSection(generalPane, "group-appearance");
  appearanceGroup.setAttribute("aria-labelledby", appearanceId);
  createSectionHead(
    appearanceGroup,
    copy.appearanceTitle,
    copy.appearanceHint,
    appearanceId,
  );

  const themeRow = create("div", "ch-settings-row ch-settings-row--stack");
  const themeRowMain = create("div", "ch-settings-row-main");
  const themeLabel = create("h4", "ch-settings-row-title");
  themeLabel.textContent = copy.themeTitle;
  const themeHint = create("p", "ch-settings-row-hint");
  themeHint.textContent = copy.themeHint;
  themeRowMain.append(themeLabel, themeHint);
  themeRow.appendChild(themeRowMain);

  const themeGroup = create("div", "ch-settings-theme-group");
  themeGroup.setAttribute("role", "radiogroup");
  themeGroup.setAttribute("aria-label", copy.themeAria);

  const themeButtons = new Map<SettingsTheme, HTMLButtonElement>();
  for (const option of THEME_OPTIONS) {
    const labelText = copy.themeOptions[option];
    const button = create("button", "ch-settings-theme-option");
    button.type = "button";
    button.setAttribute("role", "radio");
    button.setAttribute("data-role", `theme-${option}`);
    button.setAttribute("aria-label", labelText);

    const preview = create("span", "ch-settings-theme-preview");
    preview.setAttribute("data-preview", option);
    preview.setAttribute("aria-hidden", "true");
    const previewWindow = create("span", "ch-settings-theme-preview-window");
    preview.appendChild(previewWindow);
    button.appendChild(preview);

    const label = create("span", "ch-settings-theme-label");
    label.textContent = labelText;
    button.appendChild(label);

    button.addEventListener("click", () => {
      if (theme === option) return;
      applyTheme(option, true);
    });

    themeButtons.set(option, button);
    themeGroup.appendChild(button);
  }
  themeGroup.addEventListener("keydown", (event) => {
    const { key } = event as KeyboardEvent;
    if (key !== "ArrowRight" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const step = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
    const currentIndex = THEME_OPTIONS.indexOf(theme);
    const nextIndex = (currentIndex + step + THEME_OPTIONS.length) % THEME_OPTIONS.length;
    const next = THEME_OPTIONS[nextIndex];
    if (next === undefined) return;
    if (next !== theme) applyTheme(next, true);
    themeButtons.get(next)?.focus();
  });
  themeRow.appendChild(themeGroup);
  appearanceGroup.appendChild(themeRow);

  /* --- 自定义：用户名 + 头像 --- */

  const identitySection = createSection(generalPane, "group-identity");
  createSectionHead(identitySection, copy.identityTitle, copy.identityHint);

  const nameRow = createRow(
    identitySection,
    copy.nameTitle,
    copy.nameHint,
    "custom-name-row",
  );
  const nameInput = create("input", "ch-settings-input");
  nameInput.type = "text";
  nameInput.autocomplete = "off";
  nameInput.spellcheck = false;
  nameInput.tabIndex = 0;
  nameInput.setAttribute("data-role", "custom-name");
  nameInput.setAttribute("aria-label", copy.nameAria);
  nameInput.value = options.customName ?? "";
  nameInput.placeholder = options.localUsername?.trim() || copy.namePlaceholder;
  nameInput.addEventListener("input", () => {
    options.onUsernameChange?.(nameInput.value);
  });
  nameRow.control.appendChild(nameInput);

  const avatarRow = createRow(
    identitySection,
    copy.avatarTitle,
    copy.avatarHint,
    "custom-avatar-row",
  );
  const avatarControl = create("div", "ch-settings-avatar-control");
  const avatarPreview = create("span", "ch-settings-avatar");
  avatarPreview.setAttribute("data-role", "custom-avatar-preview");
  let avatarValue = options.avatar ?? "";

  const pickAvatarButton = create("button", "ch-settings-action");
  pickAvatarButton.type = "button";
  pickAvatarButton.tabIndex = 0;
  pickAvatarButton.setAttribute("data-role", "pick-avatar");
  pickAvatarButton.textContent = copy.pickAvatar;

  const removeAvatarButton = create("button", "ch-settings-action ch-settings-action--danger");
  removeAvatarButton.type = "button";
  removeAvatarButton.tabIndex = 0;
  removeAvatarButton.setAttribute("data-role", "remove-avatar");
  removeAvatarButton.textContent = copy.removeAvatar;

  let avatarNode: HTMLElement | null = null;
  const renderAvatarPreview = (): void => {
    avatarNode?.remove();
    avatarPreview.classList.toggle("has-image", avatarValue.length > 0);
    if (avatarValue.length > 0) {
      const image = create("img", "ch-settings-avatar-image");
      image.src = avatarValue;
      image.alt = "";
      avatarNode = image;
    } else {
      avatarNode = create("span", "icon-placeholder ch-settings-avatar-empty");
    }
    avatarPreview.appendChild(avatarNode);
    removeAvatarButton.hidden = avatarValue.length === 0;
  };

  let avatarCropOverlay: HTMLElement | null = null;

  pickAvatarButton.addEventListener("click", () => {
    if (typeof options.pickAvatarFile !== "function" || pickAvatarButton.disabled) return;
    if (avatarCropOverlay !== null) return;
    pickAvatarButton.disabled = true;
    void options
      .pickAvatarFile()
      .then((src) => {
        if (!src) return;
        const crop = createAvatarCropModal({
          src,
          language: options.language,
          onConfirm: (dataUrl) => {
            avatarValue = dataUrl;
            options.onAvatarChange?.(dataUrl);
            renderAvatarPreview();
          },
          onClose: () => {
            avatarCropOverlay = null;
          },
        });
        avatarCropOverlay = crop;
        document.body.appendChild(crop);
      })
      .finally(() => {
        pickAvatarButton.disabled = false;
      });
  });

  removeAvatarButton.addEventListener("click", () => {
    avatarValue = "";
    options.onAvatarChange?.("");
    renderAvatarPreview();
  });

  avatarControl.append(avatarPreview, pickAvatarButton, removeAvatarButton);
  avatarRow.control.appendChild(avatarControl);
  renderAvatarPreview();

  const generalFoot = create("div", "ch-settings-pane-foot");
  const generalNote = create("p", "ch-settings-note");
  generalNote.textContent = copy.generalNote;
  generalFoot.appendChild(generalNote);
  const learnMore = create("button", "ch-settings-link");
  learnMore.type = "button";
  learnMore.tabIndex = 0;
  learnMore.setAttribute("data-role", "learn-more");
  learnMore.textContent = copy.learnMore;
  generalFoot.appendChild(learnMore);
  generalPane.appendChild(generalFoot);

  /* ------------------------------------------------------------------ */
  /* 隐私：本地优先声明 + Storage/Manage 行                               */
  /* ------------------------------------------------------------------ */

  const privacyPane = createPane("pane-privacy");
  const privacySection = createSection(privacyPane);
  createSectionHead(privacySection, copy.privacyTitle, copy.privacyHint);
  const privacyStatement = create("p", "ch-settings-statement");
  privacyStatement.setAttribute("data-role", "privacy-statement");
  privacyStatement.textContent = copy.privacyStatement;
  privacySection.appendChild(privacyStatement);

  const storageSection = createSection(privacyPane);
  createRow(storageSection, copy.storageTitle, copy.storageHint, "storage-row");

  /* ------------------------------------------------------------------ */
  /* 用量：采集来源管理                                                   */
  /* ------------------------------------------------------------------ */

  const usagePane = createPane("pane-usage");
  const usageSection = createSection(usagePane);
  createSectionHead(usageSection, copy.usageSourcesTitle, copy.usageSourcesHint);

  let usageSources: UsageSourceOption[] = [...(options.usageSources ?? [])];

  const usageList = create("div", "ch-settings-source-list");
  usageList.setAttribute("data-role", "usage-source-list");
  usageSection.appendChild(usageList);

  const usageError = create("p", "ch-settings-error");
  usageError.setAttribute("data-role", "usage-source-error");
  usageError.hidden = true;
  usageSection.appendChild(usageError);

  const usageAddRow = create("div", "ch-settings-source-add");
  const usageAddButton = create("button", "ch-settings-source-btn ch-settings-source-btn--add");
  usageAddButton.type = "button";
  usageAddButton.tabIndex = 0;
  usageAddButton.setAttribute("data-role", "usage-source-add");
  usageAddButton.textContent = `+ ${copy.usageAdd}`;
  usageAddRow.appendChild(usageAddButton);
  usageSection.appendChild(usageAddRow);

  const usageFoot = create("p", "ch-settings-note");
  usageFoot.textContent = copy.usageFootNote;
  usageSection.appendChild(usageFoot);

  function showUsageError(message: string): void {
    usageError.textContent = message;
    usageError.hidden = false;
  }

  async function persistUsageSources(next: readonly UsageSourceOption[]): Promise<void> {
    usageError.hidden = true;
    // 来源只有"存在/不存在"两种状态：列出来的都在采集。
    const payload = next.map((source) => ({ ...source, enabled: true }));
    try {
      const result = await options.onSaveUsageSources?.(payload);
      if (result && !result.ok) {
        showUsageError(result.error || copy.usageSaveError);
        return;
      }
      usageSources = result?.sources ? [...result.sources] : payload;
      renderUsageSources();
    } catch {
      showUsageError(copy.usageSaveError);
    }
  }

  async function pickUsageFolder(index: number): Promise<void> {
    const directory = await options.pickUsageDirectory?.();
    if (!directory) return;
    const next = usageSources.map((source, position) =>
      position === index ? { ...source, root: directory } : source,
    );
    await persistUsageSources(next);
  }

  function renderUsageSources(): void {
    for (const child of [...usageList.children]) child.remove();
    if (usageSources.length === 0) {
      const empty = create("p", "ch-settings-source-empty");
      empty.textContent = copy.usageNoPath;
      usageList.appendChild(empty);
    }
    usageSources.forEach((source, index) => {
      const isDefault = source.kind === "claude-desktop";
      const path = source.root ?? source.resolvedRoot;
      const { main: rowMain, control } = createRow(
        usageList,
        isDefault ? copy.usageDefaultLabel : copy.usageCustomLabel,
        path.length > 0 ? path : copy.usageNoPath,
        "usage-source-row",
      );
      rowMain.children[1]?.classList.add("ch-settings-source-path");

      const pick = create("button", "ch-settings-source-btn");
      pick.type = "button";
      pick.tabIndex = 0;
      pick.setAttribute("data-role", `usage-source-pick-${source.id}`);
      pick.textContent = copy.usagePickFolder;
      pick.addEventListener("click", () => void pickUsageFolder(index));
      control.appendChild(pick);

      if (isDefault && source.root !== null) {
        const restore = create("button", "ch-settings-source-btn");
        restore.type = "button";
        restore.tabIndex = 0;
        restore.setAttribute("data-role", `usage-source-restore-${source.id}`);
        restore.textContent = copy.usageRestoreAuto;
        restore.addEventListener("click", () => {
          const next = usageSources.map((item, position) =>
            position === index ? { ...item, root: null } : item,
          );
          void persistUsageSources(next);
        });
        control.appendChild(restore);
      }

      if (!isDefault) {
        const remove = create("button", "ch-settings-source-btn ch-settings-source-btn--icon");
        remove.type = "button";
        remove.tabIndex = 0;
        remove.setAttribute("data-role", `usage-source-remove-${source.id}`);
        remove.setAttribute("aria-label", copy.usageRemove);
        remove.title = copy.usageRemove;
        remove.innerHTML = iconSvg("trash", "ch-settings-source-icon");
        remove.addEventListener("click", () => {
          const next = usageSources.filter((_item, position) => position !== index);
          void persistUsageSources(next);
        });
        control.appendChild(remove);
      }
    });
  }

  usageAddButton.addEventListener("click", () => {
    void (async () => {
      const directory = await options.pickUsageDirectory?.();
      if (!directory) return;
      const id = `custom-${Date.now().toString(36)}`;
      const next = [
        ...usageSources,
        { id, kind: "custom", root: directory, resolvedRoot: directory, enabled: true },
      ];
      await persistUsageSources(next);
    })();
  });

  renderUsageSources();

  /* ------------------------------------------------------------------ */
  /* 系统：版本与开机自启                                                  */
  /* ------------------------------------------------------------------ */

  const systemPane = createPane("pane-system");
  const appSection = createSection(systemPane);
  createSectionHead(appSection, copy.systemTitle, copy.systemHint);
  const versionRow = createRow(appSection, copy.versionTitle, copy.versionHint, "version-row");
  const versionValue = create("span", "ch-settings-value");
  versionValue.setAttribute("data-role", "app-version");
  versionValue.textContent = APP_VERSION;
  versionRow.control.appendChild(versionValue);

  const launchRow = createRow(
    appSection,
    copy.launchTitle,
    copy.launchHint,
    "launch-row",
  );
  launchRow.control.appendChild(
    createSwitch("launch-at-login", copy.launchTitle, options.launchAtLogin === true, options.onLaunchAtLoginChange),
  );

  const backgroundRow = createRow(
    appSection,
    copy.backgroundTitle,
    copy.backgroundHint,
    "background-row",
  );
  backgroundRow.control.appendChild(
    createSwitch(
      "background-on-close",
      copy.backgroundTitle,
      options.backgroundOnClose === true,
      options.onBackgroundOnCloseChange,
    ),
  );

  const hideDockTitle = copy.hideDockTitle(isMac);
  const hideDockRow = createRow(
    appSection,
    hideDockTitle,
    copy.hideDockHint(isMac),
    "hide-dock-row",
  );
  hideDockRow.control.appendChild(
    createSwitch("hide-dock", hideDockTitle, options.hideDock === true, options.onHideDockChange),
  );

  /* ------------------------------------------------------------------ */
  /* 关于：设置菜单中的正式章节，承载客户端信息                            */
  /* ------------------------------------------------------------------ */

  const clientPane = createPane("pane-about");
  const clientGroup = createSection(clientPane);
  clientGroup.setAttribute("aria-labelledby", clientHeadId);
  createSectionHead(
    clientGroup,
    copy.aboutTitle,
    copy.aboutHint,
    clientHeadId,
  );

  const infoList = create("dl", "ch-settings-info");
  const infoRows: readonly (readonly [string, string])[] = [
    [copy.appNameLabel, APP_NAME],
    [copy.connectionLabel, copy.connectionValue],
    [copy.versionLabel, APP_VERSION],
    [copy.licenseLabel, APP_LICENSE],
    ...(options.clientInfo?.username
      ? [[copy.localAccountLabel, options.clientInfo.username] as const]
      : []),
    ...(options.clientInfo?.hostname
      ? [[copy.hostnameLabel, options.clientInfo.hostname] as const]
      : []),
  ];
  for (const [label, value] of infoRows) {
    const row = create("div", "ch-settings-info-row");
    const term = create("dt", "ch-settings-info-label");
    term.textContent = label;
    const description = create("dd", "ch-settings-info-value");
    description.textContent = value;
    row.append(term, description);
    infoList.appendChild(row);
  }
  clientGroup.appendChild(infoList);

  main.appendChild(body);
  dialog.appendChild(main);

  /* ------------------------------------------------------------------ */
  /* 状态与交互                                                           */
  /* ------------------------------------------------------------------ */

  const panes = new Map<SettingsSection, HTMLElement>([
    ["general", generalPane],
    ["privacy", privacyPane],
    ["usage", usagePane],
    ["system", systemPane],
    ["about", clientPane],
  ]);

  function applyTheme(next: SettingsTheme, notify: boolean): void {
    theme = next;
    overlay.setAttribute("data-theme", next);
    for (const [value, button] of themeButtons) {
      const selected = value === next;
      button.setAttribute("aria-checked", selected ? "true" : "false");
      button.classList.toggle("is-selected", selected);
      button.tabIndex = selected ? 0 : -1;
    }
    if (notify) options.onThemeChange(next);
  }

  function setSection(next: SettingsSection): void {
    section = next;
    for (const [id, pane] of panes) pane.hidden = id !== next;
    sectionTitle.textContent = copy.sectionTitles[next];
    for (const [id, button] of navButtons) {
      const active = id === next;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    }
    learnMore.tabIndex = next === "general" ? 0 : -1;
  }

  function focusables(): HTMLElement[] {
    const items: HTMLElement[] = [];
    const visit = (element: HTMLElement): void => {
      if (element.hidden) return;
      const focusableTag =
        element.tagName === "BUTTON" ||
        element.tagName === "SELECT" ||
        element.tagName === "INPUT" ||
        element.tagName === "TEXTAREA" ||
        element.tagName === "A";
      const disabled =
        "disabled" in element &&
        (element as HTMLButtonElement | HTMLSelectElement).disabled === true;
      if (focusableTag && element.tabIndex >= 0 && !disabled) items.push(element);
      for (const child of [...element.children]) visit(child as HTMLElement);
    };
    visit(dialog);
    return items;
  }

  function close(): void {
    if (closed) return;
    closed = true;
    avatarCropOverlay?.remove();
    avatarCropOverlay = null;
    overlay.remove();
    previousFocus?.focus();
    options.onClose();
  }

  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  learnMore.addEventListener("click", () => {
    if (section === "general") setSection("about");
  });

  dialog.addEventListener("keydown", (event) => {
    const { key, shiftKey } = event as KeyboardEvent;
    if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (key !== "Tab") return;
    const items = focusables();
    if (items.length === 0) return;
    const index = items.indexOf(doc.activeElement as HTMLElement);
    if (shiftKey) {
      if (index <= 0) {
        event.preventDefault();
        items[items.length - 1]?.focus();
      }
      return;
    }
    if (index === -1 || index === items.length - 1) {
      event.preventDefault();
      items[0]?.focus();
    }
  });

  applyTheme(theme, false);
  setSection(section);

  setTimeout(() => {
    if (!closed) dialog.focus();
  }, 0);

  return overlay;
}
