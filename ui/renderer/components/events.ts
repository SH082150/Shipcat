/**
 * 应用内事件契约。
 *
 * 侧栏齿轮、账户菜单里的设置/了解更多，以及页面里的设置入口，统一派发
 * window 上的 `open-settings` 自定义事件。detail 里同时带：
 * - section: 设置弹窗要打开的章节
 *   （general / privacy / usage / system / client-info）
 * - source: 触发位置，便于设置层决定焦点
 * - clientInfo: 本机用户名等最小客户端信息
 *
 * detail 允许是对象，也兼容直接传 `"client-info"` 字符串的监听方。
 */

export const OPEN_SETTINGS_EVENT = "open-settings";

export const SETTINGS_SECTIONS = [
  "general",
  "privacy",
  "usage",
  "system",
  "about",
  "client-info",
] as const;

export type UiSettingsSection = (typeof SETTINGS_SECTIONS)[number];

export interface ClientInfo {
  readonly username?: string;
  readonly hostname?: string;
  readonly platform?: string;
  readonly appVersion?: string;
}

export interface OpenSettingsDetail {
  readonly section: UiSettingsSection;
  readonly source: string;
  readonly clientInfo: ClientInfo;
}

export interface OpenSettingsInput {
  readonly section?: UiSettingsSection | string | null;
  readonly source?: string | null;
  readonly clientInfo?: ClientInfo | null;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isSettingsSection(value: unknown): value is UiSettingsSection {
  return (
    typeof value === "string" &&
    (SETTINGS_SECTIONS as readonly string[]).includes(value)
  );
}

export function normalizeClientInfo(value: unknown): ClientInfo {
  if (value === null || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const username = text(raw.username);
  const hostname = text(raw.hostname);
  const platform = text(raw.platform);
  const appVersion = text(raw.appVersion);
  return {
    ...(username ? { username } : {}),
    ...(hostname ? { hostname } : {}),
    ...(platform ? { platform } : {}),
    ...(appVersion ? { appVersion } : {}),
  };
}

export function normalizeSettingsSection(value: unknown): UiSettingsSection {
  return isSettingsSection(value) ? value : "general";
}

export function createOpenSettingsDetail(input: OpenSettingsInput = {}): OpenSettingsDetail {
  return {
    section: normalizeSettingsSection(input.section),
    source: text(input.source) ?? "renderer",
    clientInfo: normalizeClientInfo(input.clientInfo),
  };
}

/** 把监听方拿到的任意 detail 归一，兼容字符串与对象两种形态。 */
export function normalizeOpenSettingsDetail(value: unknown): OpenSettingsDetail {
  if (typeof value === "string") {
    return createOpenSettingsDetail({ section: value });
  }
  if (value === null || typeof value !== "object") {
    return createOpenSettingsDetail();
  }
  const raw = value as Record<string, unknown>;
  return createOpenSettingsDetail({
    section: typeof raw.section === "string" ? raw.section : null,
    source: text(raw.source) ?? null,
    clientInfo: normalizeClientInfo(raw.clientInfo),
  });
}

export function dispatchOpenSettings(input: OpenSettingsInput = {}): OpenSettingsDetail | null {
  const detail = createOpenSettingsDetail(input);
  const target = (globalThis as { window?: EventTarget }).window;
  if (!target || typeof target.dispatchEvent !== "function") return null;

  const event =
    typeof CustomEvent === "function"
      ? new CustomEvent(OPEN_SETTINGS_EVENT, { detail })
      : Object.assign(new Event(OPEN_SETTINGS_EVENT), { detail });
  target.dispatchEvent(event);
  return detail;
}
