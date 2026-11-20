/**
 * 统一图标库：24×24 线性图标，描边跟随 currentColor。
 *
 * 尺寸与颜色由使用处的 class 决定（如 nav-icon / menu-icon / pv-chevron）；
 * 品牌/头像等需要用户自行设计的图标仍用 iconSlot 占位。
 */

export type IconName =
  | "search"
  | "providers"
  | "overview"
  | "settings"
  | "plus"
  | "profiles"
  | "usage"
  | "sidebar"
  | "history"
  | "quota"
  | "back"
  | "chevron-down"
  | "chevron-right"
  | "globe"
  | "info"
  | "trash"
  | "close"
  | "usage-note"
  | "config-lines"
  | "check"
  | "alert";

const PATHS: Record<IconName, string> = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M15.8 15.8 20 20"/>',
  providers:
    '<rect x="3" y="8" width="18" height="11" rx="2.2"/><path d="M9 8V6.4A2.4 2.4 0 0 1 11.4 4h1.2A2.4 2.4 0 0 1 15 6.4V8"/>',
  overview:
    '<path d="M12 3.2 20 7.7v8.6L12 20.8 4 16.3V7.7Z"/><path d="M4 7.7 12 12l8-4.3"/><path d="M12 12v8.8"/>',
  settings:
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  profiles:
    '<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.2l2 2H18a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5Z"/>',
  usage:
    '<path d="M7.9 19.1A8.2 8.2 0 1 1 16.1 19.1"/><path d="M12 10.8v3.9"/><circle cx="12" cy="16.2" r="1.25" fill="currentColor" stroke="none"/>',
  sidebar:
    '<rect x="3.2" y="4.5" width="17.6" height="15" rx="2.4"/><path d="M9 4.5v15"/><path d="M5.8 8.4h1.9"/>',
  history: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.6V12l3.2 2"/>',
  quota:
    '<rect x="4" y="7.2" width="16" height="12.8" rx="2.2"/><path d="M4 7.2h16"/><path d="M9 11l3 2.8 3-2.8"/><path d="M12 13.8v3.2"/><path d="M9.8 14.7h4.4"/><path d="M9.8 16.3h4.4"/>',
  back: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-right": '<path d="m9 6 6 6-6 6"/>',
  globe:
    '<circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4"/><path d="M12 3.8c2.4 2.4 3.6 5.1 3.6 8.2s-1.2 5.8-3.6 8.2c-2.4-2.4-3.6-5.1-3.6-8.2S9.6 6.2 12 3.8Z"/>',
  info: '<circle cx="12" cy="12" r="8.2"/><path d="M12 11.2v5"/><circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none"/>',
  trash:
    '<path d="M4 7h16"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><path d="M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7"/><path d="M10 11v5M14 11v5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  "usage-note":
    '<path d="M6.5 3.5h7L18.5 8v12a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 20V5a1.5 1.5 0 0 1 1.5-1.5Z"/><path d="M13.5 3.5V8H18"/><path d="M8.5 11h6.5M8.5 13.5h5"/><path d="M14.5 18H9.5"/><path d="m11.8 16.2-2 1.8 2 1.8"/>',
  "config-lines": '<path d="M4 8h16M7 12h10M9.5 16h5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert:
    '<path d="M12 4.5 21 20H3Z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none"/>',
};

export function iconSvg(name: IconName, className = ""): string {
  const classes = ["icon-svg", className].filter(Boolean).join(" ");
  return `<svg class="${classes}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}
