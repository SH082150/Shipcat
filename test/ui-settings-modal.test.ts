/**
 * 项目没有 DOM 依赖，这里用最小 DOM 桩驱动 settings.ts，
 * 只覆盖组件对外可观察的契约——结构、主题上抛、关闭/焦点、章节切换。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createSettingsModal } from "../ui/renderer/settings/settings.ts";

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

  focus(): void {
    if (this.hidden || this.disabled) return;
    this.ownerDocument.activeElement = this;
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

function textOf(element: FakeElement): string {
  return `${element.textContent}${element.children.map(textOf).join("")}`;
}

function key(element: FakeElement, name: string, shiftKey = false): FakeEvent {
  const event = new FakeEvent("keydown", { key: name, shiftKey });
  element.dispatchEvent(event);
  return event;
}

function mount(
  initialTheme: "light" | "dark" | "system" = "system",
  initialSection?: "general" | "client-info",
  language: "zh" | "en" = "zh",
) {
  const document = installDom();
  const trigger = document.createElement("button");
  document.body.appendChild(trigger);
  trigger.focus();

  const themes: string[] = [];
  let closes = 0;
  const root = createSettingsModal({
    language,
    initialTheme,
    ...(initialSection ? { initialSection } : {}),
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

test("渲染居中弹窗的骨架：对话框、遮罩、常规导航与外观/主题", () => {
  const modal = mount();
  try {
    const { root } = modal;
    assert.equal(root.classList.contains("ch-settings-overlay"), true);

    const [dialog] = findAll(root, (element) => element.getAttribute("role") === "dialog");
    assert.ok(dialog, "缺少 role=dialog");
    assert.equal(dialog.getAttribute("aria-modal"), "true");
    assert.equal(dialog.tabIndex, -1);
    assert.ok(dialog.getAttribute("aria-labelledby"));

    const title = byRole(root, "title");
    assert.equal(dialog.getAttribute("aria-labelledby"), title.id);
    assert.match(textOf(title), /设置/);

    const nav = byRole(root, "nav-general");
    assert.match(textOf(nav), /常规/);
    assert.equal(nav.getAttribute("aria-current"), "page");
    const navItems = findAll(root, (element) =>
      (element.getAttribute("data-role") ?? "").startsWith("nav-"),
    );
    assert.deepEqual(
      navItems.map((item) => item.getAttribute("data-role")),
      ["nav-general", "nav-privacy", "nav-system", "nav-about"],
    );
    assert.deepEqual(navItems.map(textOf), ["常规", "隐私", "系统", "关于"]);

    const group = byRole(root, "group-appearance");
    assert.match(textOf(group), /外观/);
    assert.match(textOf(group), /主题/);

    const themeButtons = findAll(root, (element) =>
      (element.getAttribute("data-role") ?? "").startsWith("theme-"),
    );
    assert.deepEqual(
      themeButtons.map((button) => textOf(button)),
      ["浅色", "深色", "系统"],
    );
    for (const button of themeButtons) {
      assert.equal(button.getAttribute("role"), "radio");
      assert.equal(button.hasAttribute("aria-checked"), true);
    }

    const close = byRole(root, "close");
    assert.equal(close.getAttribute("aria-label"), "关闭设置");
  } finally {
    modal.cleanup();
  }
});

test("英语界面：菜单、节标题、主题选项与关闭按钮均为英文", () => {
  const modal = mount("system", "general", "en");
  try {
    const { root } = modal;
    const navItems = findAll(root, (element) =>
      (element.getAttribute("data-role") ?? "").startsWith("nav-"),
    );
    assert.deepEqual(navItems.map(textOf), ["General", "Privacy", "System", "About"]);
    assert.equal(textOf(byRole(root, "section-title")), "General");
    assert.deepEqual(
      ["theme-light", "theme-dark", "theme-system"].map((role) => textOf(byRole(root, role))),
      ["Light", "Dark", "System"],
    );
    assert.equal(byRole(root, "close").getAttribute("aria-label"), "Close settings");
    assert.match(textOf(byRole(root, "group-appearance")), /Appearance/);
    assert.match(textOf(byRole(root, "group-appearance")), /Theme/);
  } finally {
    modal.cleanup();
  }
});

test("初始主题选中正确，点击仅在有变化时上抛", () => {
  const modal = mount("dark");
  try {
    const { root, themes } = modal;
    assert.equal(root.getAttribute("data-theme"), "dark");
    assert.equal(byRole(root, "theme-dark").getAttribute("aria-checked"), "true");
    assert.equal(byRole(root, "theme-light").getAttribute("aria-checked"), "false");
    assert.equal(byRole(root, "theme-dark").tabIndex, 0);
    assert.equal(byRole(root, "theme-light").tabIndex, -1);

    byRole(root, "theme-light").click();
    assert.deepEqual(themes, ["light"]);
    assert.equal(root.getAttribute("data-theme"), "light");
    assert.equal(byRole(root, "theme-light").getAttribute("aria-checked"), "true");
    assert.equal(byRole(root, "theme-dark").getAttribute("aria-checked"), "false");

    byRole(root, "theme-light").click();
    assert.deepEqual(themes, ["light"]);

    byRole(root, "theme-system").click();
    assert.deepEqual(themes, ["light", "system"]);
  } finally {
    modal.cleanup();
  }
});

test("主题单选组支持方向键切换", () => {
  const modal = mount("light");
  try {
    const { root, themes } = modal;
    const light = byRole(root, "theme-light");
    light.focus();
    key(light, "ArrowRight");
    assert.deepEqual(themes, ["dark"]);
    assert.equal(byRole(root, "theme-dark").getAttribute("aria-checked"), "true");

    const deep = byRole(root, "theme-dark");
    key(deep, "ArrowRight");
    assert.deepEqual(themes, ["dark", "system"]);

    const system = byRole(root, "theme-system");
    key(system, "ArrowRight");
    assert.deepEqual(themes, ["dark", "system", "light"]);
  } finally {
    modal.cleanup();
  }
});

test("Esc 关闭弹窗、移除节点、只回调一次并归还焦点", async () => {
  const modal = mount();
  try {
    const { document, root, trigger } = modal;
    await flushFocus();
    const [dialog] = findAll(root, (element) => element.getAttribute("role") === "dialog");
    assert.equal(document.activeElement, dialog);

    const themeButton = byRole(root, "theme-system");
    const event = key(themeButton, "Escape");
    assert.equal(event.defaultPrevented, true);
    assert.equal(root.parentNode, null);
    assert.equal(modal.closes, 1);
    assert.equal(document.activeElement, trigger);

    key(themeButton, "Escape");
    assert.equal(modal.closes, 1);
  } finally {
    modal.cleanup();
  }
});

test("关闭按钮关闭；点击遮罩关闭，点击内容不关闭", () => {
  const first = mount();
  try {
    byRole(first.root, "close").click();
    assert.equal(first.closes, 1);
    assert.equal(first.root.parentNode, null);
  } finally {
    first.cleanup();
  }

  const second = mount();
  try {
    byRole(second.root, "group-appearance").click();
    assert.equal(second.closes, 0);
    second.root.click();
    assert.equal(second.closes, 1);
  } finally {
    second.cleanup();
  }
});

test("焦点陷阱：Tab/Shift+Tab 在弹窗内循环", async () => {
  const modal = mount();
  try {
    const { document, root } = modal;
    await flushFocus();

    const nav = byRole(root, "nav-general");
    key(document.activeElement, "Tab");
    assert.equal(document.activeElement, nav);

    const last = byRole(root, "learn-more");
    last.focus();
    key(last, "Tab");
    assert.equal(document.activeElement, nav);

    nav.focus();
    key(nav, "Tab", true);
    assert.equal(document.activeElement, last);
  } finally {
    modal.cleanup();
  }
});

test("了解更多进入关于章节，客户端信息在高亮菜单中展示", () => {
  const modal = mount();
  try {
    const { root } = modal;
    const general = byRole(root, "pane-general");
    const about = byRole(root, "pane-about");

    assert.equal(general.hidden, false);
    assert.equal(about.hidden, true);

    byRole(root, "learn-more").click();
    assert.equal(general.hidden, true);
    assert.equal(about.hidden, false);
    assert.equal(byRole(root, "section-title").textContent, "关于");
    assert.equal(byRole(root, "nav-about").getAttribute("aria-current"), "page");

    const info = textOf(about);
    assert.match(info, /Shipcat/);
    assert.match(info, /本地网关/);
    assert.match(info, /0\.2\.4/);

    byRole(root, "nav-general").click();
    assert.equal(general.hidden, false);
    assert.equal(about.hidden, true);
  } finally {
    modal.cleanup();
  }
});

test("initialSection=client-info 时直接展示客户端信息", () => {
  const modal = mount("system", "client-info");
  try {
    const { root } = modal;
    assert.equal(byRole(root, "pane-general").hidden, true);
    assert.equal(byRole(root, "pane-about").hidden, false);
    assert.equal(byRole(root, "nav-general").getAttribute("aria-current"), "false");
    assert.equal(byRole(root, "nav-about").getAttribute("aria-current"), "page");
    assert.equal(byRole(root, "section-title").textContent, "关于");
    assert.equal(byRole(root, "learn-more").tabIndex, -1);
  } finally {
    modal.cleanup();
  }
});

test("样式文件覆盖定位、明暗主题与减弱动效", () => {
  const css = readFileSync(new URL("../ui/renderer/settings/settings.css", import.meta.url), "utf8");
  assert.match(css, /\.ch-settings-overlay\s*\{/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /\[data-theme="dark"\]/);
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /prefers-reduced-motion/);
});
