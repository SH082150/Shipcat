/**
 * 语言选择弹窗：居中遮罩 + 两列语言选项，当前语言高亮并带勾选标识。
 * 选择后调用 onSelect 并关闭；关闭动作只通过 onClose 上抛一次。
 */

import { LANGUAGES } from "./i18n.ts";
import type { Language } from "./i18n.ts";

export interface LanguageModalOptions {
  readonly language: Language;
  onSelect: (language: Language) => void;
  onClose?: () => void;
}

const LANGUAGE_TITLES: Record<Language, string> = {
  zh: "选择语言",
  en: "Choose your language",
};

const LANGUAGE_DETAILS: Record<Language, string> = {
  zh: "简体中文",
  en: "English (United States)",
};

export function createLanguageModal(options: LanguageModalOptions): HTMLElement {
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

  const overlay = create("div", "lang-overlay");
  overlay.setAttribute("data-role", "language-modal");

  const dialog = create("div", "lang-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  const titleId = `lang-title-${Math.random().toString(36).slice(2, 8)}`;
  dialog.setAttribute("aria-labelledby", titleId);

  const header = create("header", "lang-header");
  const title = create("h2", "lang-title");
  title.id = titleId;
  title.textContent = LANGUAGE_TITLES[options.language];
  const closeButton = create("button", "lang-close");
  closeButton.type = "button";
  closeButton.tabIndex = 0;
  closeButton.setAttribute("data-role", "language-close");
  closeButton.setAttribute("aria-label", options.language === "zh" ? "关闭" : "Close");
  const closeGlyph = create("span", "lang-close-glyph");
  closeGlyph.setAttribute("aria-hidden", "true");
  closeButton.appendChild(closeGlyph);
  header.append(title, closeButton);

  const grid = create("div", "lang-grid");
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-label", title.textContent ?? "Language");

  const buttons: HTMLButtonElement[] = [];
  for (const item of LANGUAGES) {
    const selected = item.id === options.language;
    const button = create("button", "lang-option");
    button.type = "button";
    button.tabIndex = 0;
    button.setAttribute("role", "radio");
    button.setAttribute("data-role", `language-${item.id}`);
    button.setAttribute("aria-checked", selected ? "true" : "false");
    button.setAttribute("lang", item.tag);
    if (selected) button.classList.add("is-selected");

    const name = create("span", "lang-option-name");
    name.textContent = item.label;
    const detail = create("span", "lang-option-detail");
    detail.textContent = LANGUAGE_DETAILS[item.id];
    const check = create("span", "lang-option-check");
    check.setAttribute("aria-hidden", "true");
    button.append(name, detail, check);

    button.addEventListener("click", () => {
      options.onSelect(item.id);
      close();
    });
    buttons.push(button);
    grid.appendChild(button);
  }

  dialog.append(header, grid);
  overlay.appendChild(dialog);

  function close(): void {
    if (closed) return;
    closed = true;
    overlay.remove();
    options.onClose?.();
  }

  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener("keydown", (event) => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (keyboard.key !== "ArrowRight" && keyboard.key !== "ArrowDown" &&
        keyboard.key !== "ArrowLeft" && keyboard.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const current = buttons.indexOf(doc.activeElement as HTMLButtonElement);
    const step = keyboard.key === "ArrowRight" || keyboard.key === "ArrowDown" ? 1 : -1;
    const next = buttons[(current + step + buttons.length) % buttons.length];
    next?.focus();
  });

  return overlay;
}
