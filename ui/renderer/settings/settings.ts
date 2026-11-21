/**
 * Claude Desktop 风格的设置弹窗。
 *
 * 返回的根节点是遮罩层，内部是居中对话框；调用方把它挂到 body 即可。
 * 菜单包含常规 / 隐私 / 用量 / 系统 / 关于五节；关于章节承载客户端信息，
 * client-info 深链自动映射到关于。常规页“了解更多”也进入关于。
 *
 * 除主题外，所有开关与选择器都只改本地 DOM 状态，不向上抛业务写入。
 * 主题变化只经 onThemeChange 上抛，由应用层决定如何持久化。
 * 样式由同目录 settings.css 提供，需由宿主的页面/构建自行引入。
 */

import type { ClientInfo } from "../components/events.ts";

export const SETTINGS_SECTIONS = ["general", "privacy", "usage", "system", "about"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number] | "client-info";

export type SettingsTheme = "light" | "dark" | "system";

export interface SettingsModalOptions {
  /** 弹窗关闭（Esc、关闭按钮、点击遮罩）后调用，只回调一次。 */
  onClose: () => void;
  /** 主题选择变化时调用；初始渲染不触发。 */
  onThemeChange: (mode: SettingsTheme) => void;
  initialTheme: SettingsTheme;
  initialSection?: SettingsSection;
  clientInfo?: ClientInfo;
  /** 自定义用户名；空串表示未设置，界面回退到本机用户名。 */
  customName?: string;
  /** 本机用户名，用作输入框占位与提示。 */
  localUsername?: string;
  /** 自定义头像 data URL；空串表示未设置。 */
  avatar?: string;
  onUsernameChange?: (name: string) => void;
  onAvatarChange?: (avatar: string) => void;
  /** 选择头像图片，返回 data URL；取消返回 null。 */
  pickAvatarFile?: () => Promise<string | null>;
  launchAtLogin?: boolean;
  backgroundOnClose?: boolean;
  onLaunchAtLoginChange?: (value: boolean) => void;
  onBackgroundOnCloseChange?: (value: boolean) => void;
}

interface ThemeOption {
  readonly value: SettingsTheme;
  readonly label: string;
}

const APP_NAME = "Shipcat";
/** 与 package.json 的 version 保持一致；系统页与客户端信息页展示。 */
const APP_VERSION = "0.2.1";

const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "系统" },
];

const SECTION_TITLES: Record<SettingsSection, string> = {
  general: "常规",
  privacy: "隐私",
  usage: "用量",
  system: "系统",
  about: "关于",
  "client-info": "关于",
};

const MENU_LABELS: Record<(typeof SETTINGS_SECTIONS)[number], string> = {
  general: "常规",
  privacy: "隐私",
  usage: "用量",
  system: "系统",
  about: "关于",
};

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

  let closed = false;
  let theme: SettingsTheme = options.initialTheme;
  let section: SettingsSection =
    options.initialSection === "client-info" ? "about" : (options.initialSection ?? "general");
  const previousFocus = doc.activeElement as HTMLElement | null;
  const titleId = `ch-settings-title-${++titleSeq}`;
  const appearanceId = `ch-settings-appearance-${titleSeq}`;
  const clientId = `ch-settings-client-${titleSeq}`;
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
  title.textContent = "设置";
  sidebarHead.append(brand, title);
  sidebar.appendChild(sidebarHead);

  const nav = create("nav", "ch-settings-nav");
  nav.setAttribute("aria-label", "设置导航");
  const navButtons = new Map<(typeof SETTINGS_SECTIONS)[number], HTMLButtonElement>();
  for (const id of SETTINGS_SECTIONS) {
    const button = create("button", "ch-settings-nav-item");
    button.type = "button";
    button.tabIndex = 0;
    button.setAttribute("data-role", `nav-${id}`);
    button.setAttribute("data-section", id);
    button.setAttribute("aria-current", id === section ? "page" : "false");
    button.textContent = MENU_LABELS[id];
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
  sectionTitle.textContent = SECTION_TITLES[section];
  header.appendChild(sectionTitle);

  const closeButton = create("button", "ch-settings-close");
  closeButton.type = "button";
  closeButton.tabIndex = 0;
  closeButton.setAttribute("data-role", "close");
  closeButton.setAttribute("aria-label", "关闭设置");
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

  const createNote = (parent: HTMLElement, text: string): void => {
    const note = create("p", "ch-settings-note");
    note.textContent = text;
    parent.appendChild(note);
  };

  /* ------------------------------------------------------------------ */
  /* 常规：Appearance 无外框，保留三主题卡片                              */
  /* ------------------------------------------------------------------ */

  const generalPane = createPane("pane-general");
  const appearanceGroup = createSection(generalPane, "group-appearance");
  appearanceGroup.setAttribute("aria-labelledby", appearanceId);
  createSectionHead(
    appearanceGroup,
    "Appearance",
    "调整 Shipcat 的外观，让它更适合你的工作环境。",
    appearanceId,
  );

  const themeRow = create("div", "ch-settings-row ch-settings-row--stack");
  const themeRowMain = create("div", "ch-settings-row-main");
  const themeLabel = create("h4", "ch-settings-row-title");
  themeLabel.textContent = "Theme";
  const themeHint = create("p", "ch-settings-row-hint");
  themeHint.textContent = "选择浅色、深色，或跟随系统设置。";
  themeRowMain.append(themeLabel, themeHint);
  themeRow.appendChild(themeRowMain);

  const themeGroup = create("div", "ch-settings-theme-group");
  themeGroup.setAttribute("role", "radiogroup");
  themeGroup.setAttribute("aria-label", "主题");

  const themeButtons = new Map<SettingsTheme, HTMLButtonElement>();
  for (const option of THEME_OPTIONS) {
    const button = create("button", "ch-settings-theme-option");
    button.type = "button";
    button.setAttribute("role", "radio");
    button.setAttribute("data-role", `theme-${option.value}`);
    button.setAttribute("aria-label", option.label);

    const preview = create("span", "ch-settings-theme-preview");
    preview.setAttribute("data-preview", option.value);
    preview.setAttribute("aria-hidden", "true");
    const previewWindow = create("span", "ch-settings-theme-preview-window");
    preview.appendChild(previewWindow);
    button.appendChild(preview);

    const label = create("span", "ch-settings-theme-label");
    label.textContent = option.label;
    button.appendChild(label);

    button.addEventListener("click", () => {
      if (theme === option.value) return;
      applyTheme(option.value, true);
    });

    themeButtons.set(option.value, button);
    themeGroup.appendChild(button);
  }
  themeGroup.addEventListener("keydown", (event) => {
    const { key } = event as KeyboardEvent;
    if (key !== "ArrowRight" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const step = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
    const currentIndex = THEME_OPTIONS.findIndex((option) => option.value === theme);
    const nextIndex = (currentIndex + step + THEME_OPTIONS.length) % THEME_OPTIONS.length;
    const next = THEME_OPTIONS[nextIndex];
    if (!next) return;
    if (next.value !== theme) applyTheme(next.value, true);
    themeButtons.get(next.value)?.focus();
  });
  themeRow.appendChild(themeGroup);
  appearanceGroup.appendChild(themeRow);

  /* --- 自定义：用户名 + 头像 --- */

  const identitySection = createSection(generalPane, "group-identity");
  createSectionHead(
    identitySection,
    "自定义",
    "设置显示名称与头像；留空时使用本机信息。",
  );

  const nameRow = createRow(
    identitySection,
    "用户名",
    "留空则显示本机用户名；设置后侧边栏与问候语都会使用自定义名称。",
    "custom-name-row",
  );
  const nameInput = create("input", "ch-settings-input");
  nameInput.type = "text";
  nameInput.autocomplete = "off";
  nameInput.spellcheck = false;
  nameInput.tabIndex = 0;
  nameInput.setAttribute("data-role", "custom-name");
  nameInput.setAttribute("aria-label", "自定义用户名");
  nameInput.value = options.customName ?? "";
  nameInput.placeholder = options.localUsername?.trim() || "本机用户名";
  nameInput.addEventListener("input", () => {
    options.onUsernameChange?.(nameInput.value);
  });
  nameRow.control.appendChild(nameInput);

  const avatarRow = createRow(
    identitySection,
    "头像",
    "未设置时显示空白占位；选择图片后显示你自己的头像。",
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
  pickAvatarButton.textContent = "选择图片";

  const removeAvatarButton = create("button", "ch-settings-action ch-settings-action--danger");
  removeAvatarButton.type = "button";
  removeAvatarButton.tabIndex = 0;
  removeAvatarButton.setAttribute("data-role", "remove-avatar");
  removeAvatarButton.textContent = "移除";

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

  pickAvatarButton.addEventListener("click", () => {
    if (typeof options.pickAvatarFile !== "function" || pickAvatarButton.disabled) return;
    pickAvatarButton.disabled = true;
    void options
      .pickAvatarFile()
      .then((dataUrl) => {
        if (!dataUrl) return;
        avatarValue = dataUrl;
        options.onAvatarChange?.(dataUrl);
        renderAvatarPreview();
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
  generalNote.textContent = "Shipcat 通过 ClaudeHarbor 本地网关连接 Claude Desktop。";
  generalFoot.appendChild(generalNote);
  const learnMore = create("button", "ch-settings-link");
  learnMore.type = "button";
  learnMore.tabIndex = 0;
  learnMore.setAttribute("data-role", "learn-more");
  learnMore.textContent = "了解更多";
  generalFoot.appendChild(learnMore);
  generalPane.appendChild(generalFoot);

  /* ------------------------------------------------------------------ */
  /* 隐私：本地优先声明 + Storage/Manage 行                               */
  /* ------------------------------------------------------------------ */

  const privacyPane = createPane("pane-privacy");
  const privacySection = createSection(privacyPane);
  createSectionHead(
    privacySection,
    "本地优先",
    "Shipcat 在你的设备上运行，默认不引入任何中转服务。",
  );
  const privacyStatement = create("p", "ch-settings-statement");
  privacyStatement.setAttribute("data-role", "privacy-statement");
  privacyStatement.textContent =
    "供应商与 profile 只保存在本机。密钥仅存储在本机，不会上传。所有请求直接发送到你配置的上游服务。使用统计来自 Claude 本地账本。";
  privacySection.appendChild(privacyStatement);

  const storageSection = createSection(privacyPane);
  const storageRow = createRow(
    storageSection,
    "Storage",
    "管理本机的供应商、profile 与用量缓存。",
    "storage-row",
  );
  const manageButton = create("button", "ch-settings-action");
  manageButton.type = "button";
  manageButton.tabIndex = 0;
  manageButton.setAttribute("data-role", "storage-manage");
  manageButton.textContent = "Manage";
  storageRow.control.appendChild(manageButton);

  /* ------------------------------------------------------------------ */
  /* 用量：侧边栏显示开关                                                  */
  /* ------------------------------------------------------------------ */

  const usagePane = createPane("pane-usage");
  const usageSidebarSection = createSection(usagePane);
  createSectionHead(
    usageSidebarSection,
    "侧边栏",
    "决定用量信息是否出现在主界面的侧边栏。",
  );
  const usageSidebarRow = createRow(
    usageSidebarSection,
    "在侧边栏显示用量",
    "收起侧栏时仍保留入口，不占用主区域空间。",
    "usage-sidebar-row",
  );
  usageSidebarRow.control.appendChild(
    createSwitch("usage-sidebar-toggle", "在侧边栏显示用量", true),
  );

  /* ------------------------------------------------------------------ */
  /* 系统：版本、开机自启、通知开关                                        */
  /* ------------------------------------------------------------------ */

  const systemPane = createPane("pane-system");
  const appSection = createSection(systemPane);
  createSectionHead(appSection, "应用", "当前安装的版本与启动方式。");
  const versionRow = createRow(appSection, "版本", "Shipcat 桌面客户端的版本号。", "version-row");
  const versionValue = create("span", "ch-settings-value");
  versionValue.setAttribute("data-role", "app-version");
  versionValue.textContent = APP_VERSION;
  versionRow.control.appendChild(versionValue);

  const launchRow = createRow(
    appSection,
    "开机自启",
    "登录系统后自动启动 Shipcat。",
    "launch-row",
  );
  launchRow.control.appendChild(
    createSwitch("launch-at-login", "开机自启", options.launchAtLogin === true, options.onLaunchAtLoginChange),
  );

  const backgroundRow = createRow(
    appSection,
    "关闭窗口后继续运行",
    "关闭窗口时隐藏到后台，网关与统计继续工作。",
    "background-row",
  );
  backgroundRow.control.appendChild(
    createSwitch(
      "background-on-close",
      "关闭窗口后继续运行",
      options.backgroundOnClose === true,
      options.onBackgroundOnCloseChange,
    ),
  );

  const notifySection = createSection(systemPane);
  createSectionHead(notifySection, "通知", "所有通知仅在本机生成。");
  const notifySystemRow = createRow(
    notifySection,
    "系统通知",
    "允许 Shipcat 通过系统通知中心提醒你。",
    "notify-system-row",
  );
  notifySystemRow.control.appendChild(createSwitch("notify-system", "系统通知", true));
  const notifyErrorsRow = createRow(
    notifySection,
    "错误与状态通知",
    "在路由失败、连接异常或状态变化时提醒。",
    "notify-errors-row",
  );
  notifyErrorsRow.control.appendChild(
    createSwitch("notify-errors", "错误与状态通知", true),
  );

  /* ------------------------------------------------------------------ */
  /* 关于：设置菜单中的正式章节，承载客户端信息                            */
  /* ------------------------------------------------------------------ */

  const clientPane = createPane("pane-about");
  const clientGroup = createSection(clientPane);
  clientGroup.setAttribute("aria-labelledby", clientHeadId);
  createSectionHead(
    clientGroup,
    "关于 Shipcat",
    "当前 Claude Desktop 所连接的本机客户端。",
    clientHeadId,
  );

  const infoList = create("dl", "ch-settings-info");
  const infoRows: readonly (readonly [string, string])[] = [
    ["应用名", APP_NAME],
    ["连接方式", "本地网关"],
    ["版本", APP_VERSION],
    ...(options.clientInfo?.username ? [["本机账户", options.clientInfo.username] as const] : []),
    ...(options.clientInfo?.hostname ? [["主机名", options.clientInfo.hostname] as const] : []),
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
    sectionTitle.textContent = SECTION_TITLES[next];
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
