/** 概览页：欢迎语、当前配置、建议列表与错误通知条，纯字符串渲染。 */

import { escapeHtml, iconSlot } from "../components/html.ts";
import { iconSvg } from "../components/icons.ts";
import { catForTime, mascotStillSource } from "../components/mascot.ts";
import type { IconName } from "../components/icons.ts";
import type { Language } from "../components/i18n.ts";
import { isPageId } from "../state/navigation.ts";
import type { OverviewContent, OverviewHint, PageContext } from "./types.ts";

const en = {
  profileLabel: "Current configuration",
  modeStandard: "Standard",
  modeAdvanced: "Advanced",
  profileHint: "Claude Desktop requests use this configuration.",
  emptyTitle: "No active configuration",
  emptyBody: "Choose a profile before Claude Desktop can route through the gateway.",
  emptyAction: "Go to profiles",
  gatewayLabel: "Local gateway",
  gatewayNote: "Start it when you're ready.",
  gatewayRunning: "Running",
  switchConfig: "Switch configuration",
  standardNote: "Direct Anthropic",
  standardHint: "No local gateway",
  suggestionsTitle: "Suggestions",
  hintUsageTitle: "Review usage",
  hintUsageBody: "Review requests and tokens recorded by Claude on this device.",
  hintProfilesTitle: "Switch configuration",
  hintProfilesBody: "Pick the provider and model Claude Desktop should use.",
  noticeTitle: "Gateway connection failed",
  noticeBody:
    "Claude Desktop could not reach the local gateway. Check the configuration and try again.",
  noticeDetails: "View details",
  noticeRetry: "Retry",
  noticeSettings: "Open settings",
  noticeClose: "Close",
  noticeReopen: "Preview notification",
} as const;

type OverviewCopyKey = keyof typeof en;

const zh: Record<OverviewCopyKey, string> = {
  profileLabel: "当前配置",
  modeStandard: "标准",
  modeAdvanced: "进阶",
  profileHint: "Claude Desktop 的请求将使用这个配置。",
  emptyTitle: "还没有激活的配置",
  emptyBody: "先选择一个档案，Claude Desktop 才能通过本地网关发送请求。",
  emptyAction: "前往档案",
  gatewayLabel: "本地网关",
  gatewayNote: "准备好后开启。",
  gatewayRunning: "运行中",
  switchConfig: "切换配置",
  standardNote: "直连 Anthropic",
  standardHint: "无需本地网关",
  suggestionsTitle: "建议",
  hintUsageTitle: "查看用量",
  hintUsageBody: "查看 Claude 在这台设备上记录的请求与 Token。",
  hintProfilesTitle: "切换配置",
  hintProfilesBody: "选择 Claude Desktop 使用的供应商与模型。",
  noticeTitle: "网关连接失败",
  noticeBody: "Claude Desktop 暂时无法连接本地网关，请检查配置后重试。",
  noticeDetails: "查看详情",
  noticeRetry: "重试",
  noticeSettings: "打开设置",
  noticeClose: "关闭",
  noticeReopen: "重新预览通知",
};

/** 局部中英文案：概览页新增文案不进共享 i18n 表，避免与其他页面耦合。 */
export const OVERVIEW_COPY: Record<Language, Record<OverviewCopyKey, string>> = {
  en,
  zh,
};

type OverviewCopy = Record<OverviewCopyKey, string>;

type GreetingPeriod = "morning" | "afternoon" | "evening" | "night";

const GREETING_PHRASES: Record<Language, Record<GreetingPeriod, string>> = {
  en: {
    morning: "Good morning",
    afternoon: "Good afternoon",
    evening: "Good evening",
    night: "Good night",
  },
  zh: {
    morning: "早上好",
    afternoon: "下午好",
    evening: "晚上好",
    night: "晚上好",
  },
};

export interface GreetingOptions {
  readonly username?: string | null;
  readonly language?: Language;
  /** 测试或调用方需要固定时间段时传入；默认当前时间。 */
  readonly now?: Date;
}

function greetingPeriod(hour: number): GreetingPeriod {
  if (hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}

/**
 * 官方风格欢迎语：按本地时间选择时段，有 username 时追加 “, alice”/“，小明”。
 * 不读取 DOM，可在 Node 里直接测试。
 */
export function formatGreeting(options: GreetingOptions = {}): string {
  const language = options.language ?? "en";
  const phrase = GREETING_PHRASES[language][greetingPeriod((options.now ?? new Date()).getHours())];
  const username = text(options.username);
  if (!username) return phrase;
  return `${phrase}${language === "zh" ? "，" : ", "}${username}`;
}

/** 自定义 greeting 支持 {username} 占位；缺用户名时去掉悬空逗号并回落到纯时段问候。 */
function resolveGreeting(
  value: string | undefined,
  language: Language,
  username: string | undefined,
): string {
  const template = text(value);
  if (!template) return formatGreeting({ username, language });
  if (!template.includes("{username}")) return template;

  const name = text(username);
  const replaced = template
    .replace(/\{username\}/g, name ?? "")
    .replace(/[,，]\s*$/, "")
    .trim();
  return replaced.length > 0 ? replaced : formatGreeting({ language });
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function defaultHints(copy: OverviewCopy): readonly OverviewHint[] {
  return [
    {
      id: "usage",
      title: copy.hintUsageTitle,
      description: copy.hintUsageBody,
      target: { action: "navigate", page: "usage" },
    },
    {
      id: "profiles",
      title: copy.hintProfilesTitle,
      description: copy.hintProfilesBody,
      target: { action: "navigate", page: "profiles" },
    },
  ];
}

function resolveHints(content: OverviewContent, copy: OverviewCopy): readonly OverviewHint[] {
  if (content.hints === undefined) return defaultHints(copy);
  return Array.isArray(content.hints) ? content.hints : [];
}

function renderNotice(copy: OverviewCopy): string {
  // summary 显式声明 data-action，避免 shell 把点击当成 workspace 的 data-page
  // 导航而整页重渲染；只有原生 details 负责收起/展开。
  return `<details class="ov-notice" data-role="error-notification" open>
    <summary class="ov-notice-toggle" data-action="notice-toggle" data-role="error-notification-toggle">
      <span class="ov-notice-toggle-label ov-notice-toggle-label--close">${escapeHtml(copy.noticeClose)}</span>
      <span class="ov-notice-toggle-label ov-notice-toggle-label--restore">${iconSlot("ov-notice-restore-icon")}${escapeHtml(copy.noticeReopen)}</span>
    </summary>
    <section class="ov-notice-body" role="alert" aria-labelledby="ov-notice-title">
      ${iconSvg("info", "ov-notice-icon")}
      <div class="ov-notice-copy">
        <h2 class="ov-notice-title" id="ov-notice-title">${escapeHtml(copy.noticeTitle)}</h2>
        <p class="ov-notice-text">${escapeHtml(copy.noticeBody)}</p>
        <div class="ov-notice-foot">
          <button type="button" class="ov-notice-link" data-action="learn-more" data-section="client-info" data-source="overview-error-details">${escapeHtml(copy.noticeDetails)}</button>
          <div class="ov-notice-actions">
            <button type="button" class="ov-notice-button" data-action="gateway-start" data-source="overview-error-retry">${escapeHtml(copy.noticeRetry)}</button>
            <button type="button" class="ov-notice-button" data-action="settings" data-section="general" data-source="overview-error-settings">${escapeHtml(copy.noticeSettings)}</button>
          </div>
        </div>
      </div>
    </section>
  </details>`;
}

function hintActionAttributes(hint: OverviewHint): string {
  const source = `overview-hint-${hint.id}`;
  if (hint.target.action === "settings") {
    const section = hint.target.section === "client-info" ? "client-info" : "general";
    return `data-action="settings" data-section="${section}" data-source="${escapeHtml(source)}"`;
  }
  const page = isPageId(hint.target.page) ? hint.target.page : "overview";
  return `data-action="navigate" data-page="${page}" data-source="${escapeHtml(source)}"`;
}

function hintIcon(hint: OverviewHint): IconName {
  if (hint.target.action === "navigate" && hint.target.page === "usage") return "usage-note";
  if (hint.target.action === "navigate" && hint.target.page === "profiles") return "config-lines";
  return "info";
}

function renderHint(hint: OverviewHint): string {
  return `<li class="ov-hint" data-hint="${escapeHtml(hint.id)}">
      <button type="button" class="ov-hint-button" ${hintActionAttributes(hint)}>
        ${iconSvg(hintIcon(hint), "ov-hint-icon")}
        <span class="ov-hint-copy">
          <span class="ov-hint-title">${escapeHtml(hint.title)}</span>
          <span class="ov-hint-body">${escapeHtml(hint.description)}</span>
        </span>
      </button>
    </li>`;
}

function renderHints(copy: OverviewCopy, hints: readonly OverviewHint[]): string {
  if (hints.length === 0) return "";
  return `<section class="ov-suggestions" data-role="overview-suggestions" aria-labelledby="ov-suggestions-title">
    <div class="ov-section-head">
      <h2 class="ov-section-title" id="ov-suggestions-title">${escapeHtml(copy.suggestionsTitle)}</h2>
    </div>
    <ul class="ov-hint-list">
      ${hints.map(renderHint).join("\n      ")}
    </ul>
  </section>`;
}

export function render({ language, overview, clientInfo }: PageContext): string {
  const copy = OVERVIEW_COPY[language] ?? OVERVIEW_COPY.en;
  const content = overview ?? {};
  const greeting = resolveGreeting(content.greeting, language, text(clientInfo?.username));
  const activeProfile = text(content.activeProfile);
  const mode = content.mode === "advanced" ? "advanced" : "standard";
  const hints = resolveHints(content, copy).slice(0, 2);
  const mascotCat = catForTime();

  const gatewayError = text(content.gatewayError);
  return `<article class="page page--overview" data-role="page-overview" data-mode="${mode}" data-profile="${activeProfile ? "active" : "empty"}">
    <div class="ov-notice-slot${gatewayError ? " has-notice" : ""}">${gatewayError ? renderNotice(copy) : ""}</div>

    <header class="ov-welcome">
      <button type="button" class="ov-mascot" data-role="overview-mascot-button" aria-label="摸摸小猫" title="摸摸小猫"><img class="ov-mascot-img" data-role="overview-mascot" data-clip="cat-${mascotCat}-still" src="${escapeHtml(mascotStillSource(mascotCat))}" alt="" draggable="false" /></button>
      <h1 class="ov-greeting" data-role="overview-greeting">${escapeHtml(greeting)}</h1>
    </header>

    ${renderHints(copy, hints)}
  </article>`;
}
