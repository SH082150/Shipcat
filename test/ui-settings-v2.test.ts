/**
 * 用最小 DOM 桩驱动 settings.ts，不引入真实浏览器依赖。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SETTINGS_SECTIONS,
  createSettingsModal,
} from "../ui/renderer/settings/settings.ts";
import type {
  SettingsSection,
  SettingsTheme,
} from "../ui/renderer/settings/settings.ts";

type Init = Record<string, unknown>;

class FakeEvent {
  readonly type: string;
  target: FakeElement | null = null;
  currentTarget: FakeElement | null = null;
  defaultPrevented = false;
  propagationStopped = false;
  key = "";
  shiftKey = false;

  constructor(type: string, init: Init = {}) {
    this.type = type;
    Object.assign(this, init);
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }
}

type Listener = (event: FakeEvent) => void;

class FakeElement {
  readonly tagName: string;
  readonly ownerDocument: FakeDocument;
  className = "";
  textContent = "";
  hidden = false;
  tabIndex = -1;
  disabled = false;
  id = "";
  value = "";
  style: Record<string, string> = {};
  naturalWidth = 0;
  naturalHeight = 0;
  parentNode: FakeElement | null = null;
  children: FakeElement[] = [];
  private attributes = new Map<string, string>();
  private listeners = new Map<string, Listener[]>();

  constructor(tag: string, ownerDocument: FakeDocument) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = ownerDocument;
  }

  get classList() {
    const element = this;
    const read = (): string[] => element.className.split(/\s+/).filter(Boolean);
    return {
      add(...tokens: string[]): void {
        element.className = [...new Set([...read(), ...tokens])].join(" ");
      },
      remove(...tokens: string[]): void {
        element.className = read()
          .filter((token) => !tokens.includes(token))
          .join(" ");
      },
      contains(token: string): boolean {
        return read().includes(token);
      },
      toggle(token: string, force?: boolean): boolean {
        const has = read().includes(token);
        const next = force ?? !has;
        if (next && !has) element.classList.add(token);
        if (!next && has) element.classList.remove(token);
        return next;
      },
    };
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
    if (name === "class") this.className = String(value);
    if (name === "id") this.id = String(value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  appendChild<T extends FakeElement>(child: T): T {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: (FakeElement | string)[]): void {
    for (const node of nodes) {
      if (typeof node === "string") {
        this.textContent += node;
        continue;
      }
      this.appendChild(node);
    }
  }

  remove(): void {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((item) => item !== listener),
    );
  }

  dispatchEvent(event: FakeEvent): boolean {
    event.target = this;
    let node: FakeElement | null = this;
    while (node) {
      event.currentTarget = node;
      for (const listener of [...(node.listeners.get(event.type) ?? [])]) {
        listener(event);
      }
      if (event.propagationStopped) break;
      node = node.parentNode;
    }
    return !event.defaultPrevented;
  }

  click(): void {
    this.dispatchEvent(new FakeEvent("click"));
  }

  change(): void {
    this.dispatchEvent(new FakeEvent("change"));
  }

  focus(): void {
    if (this.hidden || this.disabled) return;
    this.ownerDocument.activeElement = this;
  }

  getContext(): { drawImage(): void } {
    return { drawImage: () => {} };
  }

  toDataURL(): string {
    return "data:image/png;base64,AVATAR";
  }
}

class FakeDocument {
  readonly body: FakeElement;
  activeElement: FakeElement;

  constructor() {
    this.body = new FakeElement("body", this);
    this.activeElement = this.body;
  }

  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
}

function installDom(): FakeDocument {
  const document = new FakeDocument();
  (globalThis as Record<string, unknown>).document = document;
  return document;
}

function uninstallDom(): void {
  delete (globalThis as Record<string, unknown>).document;
}

function findAll(root: FakeElement, predicate: (element: FakeElement) => boolean): FakeElement[] {
  const found: FakeElement[] = [];
  const visit = (element: FakeElement): void => {
    if (predicate(element)) found.push(element);
    element.children.forEach(visit);
  };
  visit(root);
  return found;
}

function byRole(root: FakeElement, role: string): FakeElement {
  const [element] = findAll(root, (node) => node.getAttribute("data-role") === role);
  assert.ok(element, `缺少 data-role="${role}"`);
  return element;
}

function roleCount(root: FakeElement, role: string): number {
  return findAll(root, (node) => node.getAttribute("data-role") === role).length;
}

function textOf(element: FakeElement): string {
  return `${element.textContent}${element.children.map(textOf).join("")}`;
}

function key(element: FakeElement, name: string, shiftKey = false): FakeEvent {
  const event = new FakeEvent("keydown", { key: name, shiftKey });
  element.dispatchEvent(event);
  return event;
}

function assertFocused(actual: FakeElement, expected: FakeElement, label: string): void {
  assert.equal(actual === expected, true, label);
}

interface MountOptions {
  language?: "zh" | "en";
  theme?: SettingsTheme;
  section?: SettingsSection;
  platform?: string;
  customName?: string;
  localUsername?: string;
  avatar?: string;
  hideDock?: boolean;
  pickAvatar?: () => Promise<string | null>;
  onName?: (name: string) => void;
  onAvatar?: (avatar: string) => void;
  onHideDock?: (value: boolean) => void;
}

function mount(options: MountOptions = {}) {
  const document = installDom();
  const trigger = document.createElement("button");
  document.body.appendChild(trigger);
  trigger.focus();

  const themes: string[] = [];
  let closes = 0;
  const root = createSettingsModal({
    language: options.language ?? "zh",
    initialTheme: options.theme ?? "light",
    ...(options.section ? { initialSection: options.section } : {}),
    ...(options.platform ? { clientInfo: { platform: options.platform } } : {}),
    ...(options.hideDock === undefined ? {} : { hideDock: options.hideDock }),
    ...(options.customName !== undefined ? { customName: options.customName } : {}),
    ...(options.localUsername ? { localUsername: options.localUsername } : {}),
    ...(options.avatar !== undefined ? { avatar: options.avatar } : {}),
    ...(options.pickAvatar ? { pickAvatarFile: options.pickAvatar } : {}),
    ...(options.onName ? { onUsernameChange: options.onName } : {}),
    ...(options.onAvatar ? { onAvatarChange: options.onAvatar } : {}),
    ...(options.onHideDock ? { onHideDockChange: options.onHideDock } : {}),
    onThemeChange: (mode) => themes.push(mode),
    onClose: () => {
      closes += 1;
    },
  }) as unknown as FakeElement;
  document.body.appendChild(root);

  const cleanup = (): void => {
    root.remove();
    uninstallDom();
  };

  return {
    document,
    root,
    trigger,
    themes,
    get closes() {
      return closes;
    },
    cleanup,
  };
}

const flushFocus = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const NAV_SECTIONS = [
  ["general", "常规"],
  ["privacy", "隐私"],
  ["system", "系统"],
  ["about", "关于"],
] as const;

test("菜单顺序为常规、隐私、系统、关于，且不显示版本号", () => {
  assert.deepEqual([...SETTINGS_SECTIONS], ["general", "privacy", "system", "about"]);

  const modal = mount();
  try {
    const { root } = modal;
    const navs = findAll(root, (element) => (element.getAttribute("data-role") ?? "").startsWith("nav-"));
    assert.deepEqual(
      navs.map((nav) => nav.getAttribute("data-section")),
      ["general", "privacy", "system", "about"],
    );
    assert.deepEqual(
      navs.map((nav) => textOf(nav)),
      ["常规", "隐私", "系统", "关于"],
    );
    assert.equal(roleCount(root, "nav-client"), 0);

    const sidebar = byRole(root, "sidebar");
    assert.doesNotMatch(textOf(sidebar), /0\.2\.5/);
    assert.doesNotMatch(textOf(sidebar), /版本/);
    assert.match(textOf(byRole(root, "title")), /设置/);
  } finally {
    modal.cleanup();
  }
});

test("英语界面：菜单与章节标题使用英文", () => {
  const modal = mount({ language: "en" });
  try {
    const { root } = modal;
    const navs = findAll(root, (element) => (element.getAttribute("data-role") ?? "").startsWith("nav-"));
    assert.deepEqual(navs.map(textOf), ["General", "Privacy", "System", "About"]);
    assert.equal(textOf(byRole(root, "section-title")), "General");
    byRole(root, "nav-system").click();
    assert.equal(textOf(byRole(root, "section-title")), "System");
    assert.match(textOf(byRole(root, "launch-row")), /Open at login/);
    assert.match(textOf(byRole(root, "hide-dock-row")), /Hide taskbar icon/);
  } finally {
    modal.cleanup();
  }
});

test("initialSection 支持常规、隐私、系统、关于及 client-info 别名", () => {
  const cases: readonly (readonly [SettingsSection, string, string | null])[] = [
    ["general", "常规", "general"],
    ["privacy", "隐私", "privacy"],
    ["system", "系统", "system"],
    ["about", "关于", "about"],
    ["client-info", "关于", "about"],
  ];

  for (const [section, title, activeNav] of cases) {
    const modal = mount({ section });
    try {
      const { root } = modal;
      const sections = ["general", "privacy", "system", "about"] as const;
      const activeSection = section === "client-info" ? "about" : section;
      for (const name of sections) {
        assert.equal(
          byRole(root, `pane-${name}`).hidden,
          name !== activeSection,
          `${section} 下 pane-${name} 的显隐不正确`,
        );
      }
      assert.equal(byRole(root, "section-title").textContent, title);
      for (const name of ["general", "privacy", "system", "about"] as const) {
        assert.equal(
          byRole(root, `nav-${name}`).getAttribute("aria-current"),
          name === activeNav ? "page" : "false",
        );
      }
    } finally {
      modal.cleanup();
    }
  }
});

test("点击菜单切换章节，标题与 aria-current 同步", () => {
  const modal = mount({ section: "general" });
  try {
    const { root } = modal;
    for (const [section, title] of NAV_SECTIONS) {
      byRole(root, `nav-${section}`).click();
      assert.equal(byRole(root, "section-title").textContent, title);
      assert.equal(byRole(root, `nav-${section}`).getAttribute("aria-current"), "page");
      assert.equal(byRole(root, `pane-${section}`).hidden, false);
      for (const [other] of NAV_SECTIONS) {
        if (other === section) continue;
        assert.equal(byRole(root, `nav-${other}`).getAttribute("aria-current"), "false");
        assert.equal(byRole(root, `pane-${other}`).hidden, true);
      }
    }
  } finally {
    modal.cleanup();
  }
});

test("常规页保留外观设置与三主题卡片，主题变化仅上抛 theme", () => {
  const modal = mount({ section: "general", theme: "system" });
  try {
    const { root, themes } = modal;
    const appearance = byRole(root, "group-appearance");
    assert.match(textOf(appearance), /外观/);
    assert.match(textOf(appearance), /主题/);

    const options = ["theme-light", "theme-dark", "theme-system"].map((role) => byRole(root, role));
    assert.deepEqual(options.map(textOf), ["浅色", "深色", "系统"]);
    for (const option of options) {
      assert.equal(option.getAttribute("role"), "radio");
      assert.equal(option.hasAttribute("aria-checked"), true);
    }
    assert.equal(byRole(root, "theme-system").getAttribute("aria-checked"), "true");

    byRole(root, "theme-dark").click();
    assert.deepEqual(themes, ["dark"]);
    assert.equal(root.getAttribute("data-theme"), "dark");
    assert.equal(modal.closes, 0);

    byRole(root, "theme-light").click();
    assert.deepEqual(themes, ["dark", "light"]);
    assert.equal(modal.closes, 0);
  } finally {
    modal.cleanup();
  }
});

test("常规页的了解更多进入关于章节，并同步菜单高亮", () => {
  const modal = mount({ section: "general" });
  try {
    const { root } = modal;
    byRole(root, "learn-more").click();
    assert.equal(byRole(root, "pane-general").hidden, true);
    assert.equal(byRole(root, "pane-about").hidden, false);
    assert.equal(byRole(root, "section-title").textContent, "关于");
    assert.equal(byRole(root, "nav-about").getAttribute("aria-current"), "page");
    const info = textOf(byRole(root, "pane-about"));
    assert.match(info, /Shipcat/);
    assert.match(info, /0\.2\.5/);
  } finally {
    modal.cleanup();
  }
});

test("系统页隐藏 Dock / 任务栏图标：文案随平台切换并上抛开关", () => {
  const changes: boolean[] = [];
  const mac = mount({
    section: "system",
    platform: "darwin",
    hideDock: true,
    onHideDock: (value) => changes.push(value),
  });
  try {
    const row = byRole(mac.root, "hide-dock-row");
    assert.match(textOf(row), /隐藏 Dock 图标/);
    assert.match(textOf(row), /菜单栏/);

    const toggle = byRole(mac.root, "hide-dock");
    assert.equal(toggle.getAttribute("role"), "switch");
    assert.equal(toggle.getAttribute("aria-checked"), "true");
    toggle.click();
    assert.deepEqual(changes, [false]);
    assert.equal(toggle.getAttribute("aria-checked"), "false");
  } finally {
    mac.cleanup();
  }

  const win = mount({ section: "system", platform: "win32" });
  try {
    const row = byRole(win.root, "hide-dock-row");
    assert.match(textOf(row), /隐藏任务栏图标/);
    assert.match(textOf(row), /托盘/);
  } finally {
    win.cleanup();
  }
});

test("隐私页给出本地优先声明与存储说明", () => {
  const modal = mount({ section: "privacy" });
  try {
    const { root } = modal;
    const statement = textOf(byRole(root, "privacy-statement"));
    assert.match(statement, /供应商/);
    assert.match(statement, /档案/);
    assert.match(statement, /密钥/);
    assert.match(statement, /本机|这台机器/);
    assert.match(statement, /上游/);

    const storage = byRole(root, "storage-row");
    assert.match(textOf(storage), /存储/);
    assert.equal(roleCount(root, "storage-manage"), 0, "无行为的 Manage 按钮已移除");
    assert.equal(modal.closes, 0);
    assert.deepEqual(modal.themes, []);
  } finally {
    modal.cleanup();
  }
});

test("系统页显示 0.2.5 与开机自启开关", () => {
  const modal = mount({ section: "system" });
  try {
    const { root } = modal;
    assert.equal(textOf(byRole(root, "app-version")), "0.2.5");

    const launch = byRole(root, "launch-at-login");
    assert.equal(launch.getAttribute("role"), "switch");
    assert.equal(launch.getAttribute("aria-checked"), "false");
    launch.click();
    assert.equal(launch.getAttribute("aria-checked"), "true");

    assert.equal(modal.closes, 0);
    assert.deepEqual(modal.themes, []);
  } finally {
    modal.cleanup();
  }
});

test("Esc、关闭按钮、遮罩关闭与焦点归还保持不变", async () => {
  const first = mount({ section: "general" });
  try {
    const { document, root, trigger } = first;
    await flushFocus();
    const [dialog] = findAll(root, (element) => element.getAttribute("role") === "dialog");
    assert.ok(dialog);
    assertFocused(document.activeElement, dialog, "初始焦点应在对话框");

    const event = key(byRole(root, "learn-more"), "Escape");
    assert.equal(event.defaultPrevented, true);
    assert.equal(root.parentNode, null);
    assert.equal(first.closes, 1);
    assertFocused(document.activeElement, trigger, "关闭后焦点应归还触发器");
    key(byRole(root, "learn-more"), "Escape");
    assert.equal(first.closes, 1);
  } finally {
    first.cleanup();
  }

  const second = mount({ section: "system" });
  try {
    byRole(second.root, "close").click();
    assert.equal(second.closes, 1);
    assert.equal(second.root.parentNode, null);
  } finally {
    second.cleanup();
  }

  const third = mount({ section: "system" });
  try {
    byRole(third.root, "launch-at-login").click();
    assert.equal(third.closes, 0);
    third.root.click();
    assert.equal(third.closes, 1);
  } finally {
    third.cleanup();
  }
});

test("焦点陷阱跟随当前章节，只在可见控件间循环", async () => {
  const general = mount({ section: "general" });
  try {
    const { document, root } = general;
    await flushFocus();
    const navGeneral = byRole(root, "nav-general");
    key(document.activeElement, "Tab");
    assertFocused(document.activeElement, navGeneral, "Tab 应进入导航首项");

    const last = byRole(root, "learn-more");
    last.focus();
    key(last, "Tab");
    assertFocused(document.activeElement, navGeneral, "末项 Tab 应回到导航首项");

    navGeneral.focus();
    key(navGeneral, "Tab", true);
    assertFocused(document.activeElement, last, "首项 Shift+Tab 应回到末项");
  } finally {
    general.cleanup();
  }

  const system = mount({ section: "system" });
  try {
    const { document, root } = system;
    await flushFocus();
    const navGeneral = byRole(root, "nav-general");
    const lastControl = byRole(root, "hide-dock");
    lastControl.focus();
    key(lastControl, "Tab");
    assertFocused(document.activeElement, navGeneral, "系统页末项应循环到导航首项");
    navGeneral.focus();
    key(navGeneral, "Tab", true);
    assertFocused(document.activeElement, lastControl, "导航首项 Shift+Tab 应回到系统页末项");
  } finally {
    system.cleanup();
  }
});

test("样式约束：居中遮罩、细线、无卡片外框、蓝色开关与中性主题选中", () => {
  const css = readFileSync(new URL("../ui/renderer/settings/settings.css", import.meta.url), "utf8");

  assert.match(css, /\.ch-settings-overlay\s*\{/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /align-items:\s*center/);
  assert.match(css, /justify-content:\s*center/);
  assert.match(css, /\[data-theme="dark"\]/);
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /prefers-reduced-motion/);

  const sectionRule = css.match(/\.ch-settings-section\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.ok(sectionRule, "缺少 .ch-settings-section 规则");
  assert.doesNotMatch(sectionRule, /background|border-radius|box-shadow/);

  assert.match(css, /\.ch-settings-theme-option\s*\{/);
  assert.match(css, /\.ch-settings-theme-preview\s*\{/);

  assert.match(css, /--ch-switch-on:\s*#[0-9a-f]{6}/i);
  assert.match(css, /\.ch-settings-switch\[aria-checked="true"\][\s\S]*?var\(--ch-switch-on\)/);
  assert.doesNotMatch(css, /\.ch-settings-switch[^{]*\{[^}]*--ch-brand/);

  const selectedTheme = css.match(/\.ch-settings-theme-option\.is-selected\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.ok(selectedTheme, "缺少主题选中样式");
  assert.doesNotMatch(selectedTheme, /--ch-brand/);
  assert.match(selectedTheme, /--ch-switch-on|--ch-text|--ch-border-strong/);

  assert.match(css, /\.ch-settings-switch\s*\{/);
  assert.match(css, /border-radius:\s*999px/);

  assert.doesNotMatch(css, /\.ch-settings-manage[^{]*\{[^}]*--ch-brand/);
  assert.doesNotMatch(css, /\.ch-settings-link[^{]*\{[^}]*--ch-brand/);
  assert.doesNotMatch(css, /\.button--primary|\.ch-settings-primary/);
});

test("常规页自定义：用户名回退占位、头像选择与移除", async () => {
  const names: string[] = [];
  const avatars: string[] = [];
  const modal = mount({
    section: "general",
    customName: "Harbor",
    localUsername: "demo-user",
    pickAvatar: async () => "data:image/png;base64,AAAA",
    onName: (name) => names.push(name),
    onAvatar: (avatar) => avatars.push(avatar),
  });
  try {
    const { document, root } = modal;
    const nameInput = byRole(root, "custom-name") as unknown as FakeElement & {
      value: string;
      placeholder: string;
    };
    assert.equal(nameInput.tagName, "INPUT");
    assert.equal(nameInput.value, "Harbor");
    assert.equal(nameInput.placeholder, "demo-user", "占位显示本机用户名");

    nameInput.value = "";
    nameInput.dispatchEvent(new FakeEvent("input"));
    assert.deepEqual(names, [""], "清空后上抛空串，由应用回退本机用户名");

    const preview = byRole(root, "custom-avatar-preview");
    assert.equal(
      findAll(preview, (el) => el.className.includes("icon-placeholder")).length,
      1,
      "未设置头像时显示空占位",
    );

    byRole(root, "pick-avatar").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    let crop = findAll(
      document.body,
      (el) => el.getAttribute("data-role") === "avatar-crop-overlay",
    )[0];
    assert.ok(crop, "选择图片后先打开裁剪弹窗");
    assert.deepEqual(avatars, [], "确认裁剪前不写入头像");

    byRole(crop, "avatar-crop-cancel").click();
    assert.equal(crop.parentNode, null, "取消后关闭裁剪弹窗");
    assert.deepEqual(avatars, []);

    byRole(root, "pick-avatar").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    crop = findAll(
      document.body,
      (el) => el.getAttribute("data-role") === "avatar-crop-overlay",
    )[0];
    assert.ok(crop);
    const cropImage = findAll(crop, (el) => el.tagName === "IMG")[0];
    assert.ok(cropImage);
    cropImage.naturalWidth = 512;
    cropImage.naturalHeight = 512;
    cropImage.dispatchEvent(new FakeEvent("load"));
    byRole(crop, "avatar-crop-confirm").click();
    assert.deepEqual(avatars, ["data:image/png;base64,AVATAR"]);
    assert.equal(
      findAll(preview, (el) => el.tagName === "IMG").length,
      1,
      "裁剪确认后显示图片",
    );

    const remove = byRole(root, "remove-avatar");
    assert.equal(remove.hidden, false);
    remove.click();
    assert.deepEqual(avatars, ["data:image/png;base64,AVATAR", ""]);
    assert.equal(
      findAll(preview, (el) => el.className.includes("icon-placeholder")).length,
      1,
      "移除后回到空占位",
    );
    assert.equal(remove.hidden, true);
  } finally {
    modal.cleanup();
  }
});
