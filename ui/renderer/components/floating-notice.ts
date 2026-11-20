/**
 * 悬浮通知：固定堆叠在窗口右上角，默认 4.5 秒后自动消失，也可点击关闭；
 * 返回的函数用于手动移除。
 */

import { escapeHtml } from "./html.ts";
import { iconSvg } from "./icons.ts";

export type NoticeTone = "info" | "success" | "warning" | "danger";

export interface FloatingNoticeOptions {
  readonly title: string;
  readonly message?: string;
  readonly tone?: NoticeTone;
  /** 0 表示不自动关闭。 */
  readonly timeoutMs?: number;
}

const TONE_ICON = {
  info: "info",
  success: "check",
  warning: "alert",
  danger: "alert",
} as const;

const CONTAINER_ID = "harbor-notices";

function noticeContainer(): HTMLElement {
  const existing = document.querySelector<HTMLElement>(`#${CONTAINER_ID}`);
  if (existing) return existing;
  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  container.className = "harbor-notices";
  container.setAttribute("role", "region");
  container.setAttribute("aria-label", "通知");
  document.body.appendChild(container);
  return container;
}

export function showFloatingNotice(options: FloatingNoticeOptions): () => void {
  const container = noticeContainer();
  const tone = options.tone ?? "info";
  const notice = document.createElement("div");
  notice.className = "harbor-notice";
  notice.setAttribute("data-tone", tone);
  notice.setAttribute("role", tone === "danger" ? "alert" : "status");

  const icon = document.createElement("span");
  icon.className = "harbor-notice-icon";
  icon.innerHTML = iconSvg(TONE_ICON[tone], "harbor-notice-icon-svg");

  const copy = document.createElement("div");
  copy.className = "harbor-notice-copy";
  const title = document.createElement("p");
  title.className = "harbor-notice-title";
  title.textContent = options.title;
  copy.appendChild(title);
  if (options.message) {
    const message = document.createElement("p");
    message.className = "harbor-notice-text";
    message.textContent = options.message;
    copy.appendChild(message);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "harbor-notice-close";
  close.setAttribute("aria-label", "关闭通知");
  close.innerHTML = iconSvg("close", "harbor-notice-close-icon");

  notice.append(icon, copy, close);
  container.appendChild(notice);

  let removed = false;
  const remove = (): void => {
    if (removed) return;
    removed = true;
    window.clearTimeout(timer);
    notice.remove();
    if (container.childElementCount === 0) container.remove();
  };

  close.addEventListener("click", remove);
  const timeout = options.timeoutMs ?? 4500;
  const timer = timeout > 0 ? window.setTimeout(remove, timeout) : 0;

  return remove;
}
