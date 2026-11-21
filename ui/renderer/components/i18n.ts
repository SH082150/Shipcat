/**
 * 渲染器文案表：中英两套键完全一致，语言切换时整棵界面重渲染即可。
 *
 * 只做纯函数，不读取 navigator / localStorage，便于 Node 测试直接覆盖。
 */

export const LANGUAGES = [
  { id: "en", label: "English", tag: "en" },
  { id: "zh", label: "中文", tag: "zh-CN" },
] as const;

export type Language = (typeof LANGUAGES)[number]["id"];

export const LANGUAGE_STORAGE_KEY = "claudeharbor.language";

const en = {
  "app.documentTitle": "{page} · Shipcat",

  "nav.label": "Main navigation",
  "nav.overview": "Overview",
  "nav.overviewHint": "Gateway, providers, profiles and usage at a glance.",
  "nav.providers": "Providers",
  "nav.providersHint": "Models and connections available to the gateway.",
  "nav.profiles": "Profiles",
  "nav.profilesHint": "Provider and model combinations for Claude Desktop.",
  "nav.usage": "Usage",
  "nav.usageHint": "Requests and tokens handled by the gateway.",

  "sidebar.label": "Sidebar",
  "sidebar.toggle": "Toggle sidebar",
  "sidebar.toggleTitle.pinned": "Collapse sidebar",
  "sidebar.toggleTitle.preview": "Pin sidebar open",
  "sidebar.toggleTitle.collapsed": "Pin sidebar · hover to preview",
  "sidebar.gear": "Settings",
  "sidebar.footer": "Account and settings",

  "account.menu": "Account menu",
  "account.localUser": "Local user",
  "account.localAccount": "Local account",
  "account.settings": "Settings",
  "account.language": "Language",
  "account.learnMore": "Learn more",
  "account.hint": "Account and app preferences",

  "overview.title": "Overview",

  "providers.title": "Providers",
  "providers.description":
    "Manage the model providers and credentials available to the local gateway.",
  "providers.add": "Add provider",

  "profiles.title": "Profiles",

  "usage.title": "Usage",

} as const;

export type MessageKey = keyof typeof en;

const zh: Record<MessageKey, string> = {
  "app.documentTitle": "{page} · Shipcat",

  "nav.label": "主导航",
  "nav.overview": "概览",
  "nav.overviewHint": "网关、供应商、档案与用量一览。",
  "nav.providers": "供应商",
  "nav.providersHint": "本地网关可用的模型与连接。",
  "nav.profiles": "档案",
  "nav.profilesHint": "面向 Claude Desktop 的供应商与模型组合。",
  "nav.usage": "用量",
  "nav.usageHint": "网关处理的请求与 Token 统计。",

  "sidebar.label": "侧边栏",
  "sidebar.toggle": "切换侧边栏",
  "sidebar.toggleTitle.pinned": "收起侧边栏",
  "sidebar.toggleTitle.preview": "固定侧边栏",
  "sidebar.toggleTitle.collapsed": "固定侧边栏 · 悬停预览",
  "sidebar.gear": "设置",
  "sidebar.footer": "账户与设置",

  "account.menu": "账户菜单",
  "account.localUser": "本机用户",
  "account.localAccount": "本机账户",
  "account.settings": "设置",
  "account.language": "切换语言",
  "account.learnMore": "了解更多",
  "account.hint": "账户与应用偏好",

  "overview.title": "概览",

  "providers.title": "供应商",
  "providers.description": "管理本地网关可用的模型供应商与凭据。",
  "providers.add": "添加供应商",

  "profiles.title": "档案",

  "usage.title": "用量",

};

export const MESSAGES: Record<Language, Record<MessageKey, string>> = { en, zh };

export interface Translator {
  readonly language: Language;
  t(key: MessageKey, vars?: Record<string, string | number>): string;
}

export function isLanguage(value: unknown): value is Language {
  return value === "zh" || value === "en";
}

/** 未提供或无法识别的语言一律回落到英文，避免空白界面。 */
export function detectLanguage(locale: string | null | undefined): Language {
  return typeof locale === "string" && locale.toLowerCase().startsWith("zh")
    ? "zh"
    : "en";
}

export function createTranslator(language: Language): Translator {
  const messages = MESSAGES[language] ?? MESSAGES.en;
  return {
    language,
    t(key, vars) {
      const template = messages[key] ?? MESSAGES.en[key] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
      );
    },
  };
}
