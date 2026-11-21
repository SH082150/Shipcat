/** 渲染层的最小 HTML 工具：所有动态文本必须先转义。 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

/** 空图标位；刻意不画 SVG，也不放文字字形。 */
export function iconSlot(className = ""): string {
  const classes = ["icon-placeholder", className].filter(Boolean).join(" ");
  return `<span class="${classes}" aria-hidden="true"></span>`;
}

/**
 * 头像空位：未设置时仍输出空图标位；有自定义头像时输出圆形图片容器。
 * 图片只接受 data URL（由主进程读取并转码），避免外部地址泄露。
 */
export function avatarSlot(className = "", src = ""): string {
  if (src.startsWith("data:image/")) {
    const classes = [className, "avatar-image"].filter(Boolean).join(" ");
    return `<span class="${classes}" aria-hidden="true"><img src="${escapeHtml(src)}" alt=""></span>`;
  }
  return iconSlot(className);
}
