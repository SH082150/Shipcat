/**
 * 用最小 DOM 桩驱动 language-modal.ts，不引入真实浏览器依赖。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createLanguageModal } from "../ui/renderer/components/language-modal.ts";
import { LANGUAGES } from "../ui/renderer/components/i18n.ts";

type Init = Record<string, unknown>;

class FakeEvent {
  readonly type: string;
  target: FakeElement | null = null;
  currentTarget: FakeElement | null = null;
  defaultPrevented = false;
  propagationStopped = false;
  key = "";

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
    };
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
    if (name === "class") this.className = String(value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
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

  dispatchEvent(event: FakeEvent): boolean {
    event.target = this;
    let node: FakeElement | null = this;
    while (node) {
      event.currentTarget = node;
      for (const listener of [...(node.listeners.get(event.type) ?? [])]) listener(event);
      if (event.propagationStopped) break;
      node = node.parentNode;
    }
    return !event.defaultPrevented;
  }

  click(): void {
    this.dispatchEvent(new FakeEvent("click"));
  }

  focus(): void {
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

function findAll(root: FakeElement, predicate: (element: FakeElement) => boolean): FakeElement[] {
  const found: FakeElement[] = [];
  const visit = (element: FakeElement): void => {
    if (predicate(element)) found.push(element);
    element.children.forEach(visit);
  };
  visit(root);
  return found;
}

function textOf(element: FakeElement): string {
  return `${element.textContent}${element.children.map(textOf).join("")}`;
}

test("语言弹窗：列出全部语言，当前语言选中并打勾", () => {
  const document = installDom();
  try {
    const overlay = createLanguageModal({
      language: "en",
      onSelect: () => {},
    }) as unknown as FakeElement;
    document.body.appendChild(overlay);

    const options = findAll(overlay, (el) => el.getAttribute("role") === "radio");
    assert.equal(options.length, LANGUAGES.length);
    assert.equal(
      options.filter((el) => el.getAttribute("aria-checked") === "true").length,
      1,
    );
    const selected = options.find((el) => el.getAttribute("aria-checked") === "true");
    assert.equal(selected?.getAttribute("data-role"), "language-en");
    assert.match(textOf(overlay), /Choose your language/);
    assert.match(textOf(overlay), /中文/);
    assert.match(textOf(overlay), /English/);
  } finally {
    delete (globalThis as Record<string, unknown>).document;
  }
});

test("语言弹窗：选择上抛一次并关闭，Esc 也能关闭", () => {
  const document = installDom();
  try {
    const selected: string[] = [];
    let closed = 0;
    const overlay = createLanguageModal({
      language: "zh",
      onSelect: (language) => selected.push(language),
      onClose: () => {
        closed += 1;
      },
    }) as unknown as FakeElement;
    document.body.appendChild(overlay);

    const english = findAll(overlay, (el) => el.getAttribute("data-role") === "language-en")[0];
    assert.ok(english);
    english!.click();
    assert.deepEqual(selected, ["en"]);
    assert.equal(closed, 1);
    assert.equal(overlay.parentNode, null);

    const second = createLanguageModal({
      language: "zh",
      onSelect: () => {},
      onClose: () => {},
    }) as unknown as FakeElement;
    document.body.appendChild(second);
    const event = new FakeEvent("keydown", { key: "Escape" });
    second.dispatchEvent(event);
    assert.equal(second.parentNode, null, "Esc 应关闭语言弹窗");
  } finally {
    delete (globalThis as Record<string, unknown>).document;
  }
});
