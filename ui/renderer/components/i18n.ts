/**
 * 渲染器文案表：中英两套键完全一致，语言切换时整棵界面重渲染即可。
 *
 * 只做纯函数，不读取 navigator / localStorage，便于 Node 测试直接覆盖。
 */

export const LANGUAGES = [
  { id: "zh", label: "中文", tag: "zh-CN" },
  { id: "en", label: "English", tag: "en" },
] as const;

export type Language = (typeof LANGUAGES)[number]["id"];

export const LANGUAGE_STORAGE_KEY = "claudeharbor.language";

const en = {
  "app.name": "Shipcat",
  "app.tagline": "Local gateway",
  "app.documentTitle": "{page} · Shipcat",

  "nav.label": "Main navigation",
  "nav.section": "Workspace",
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
  "account.device": "This device",
  "account.settings": "Settings",
  "account.language": "Language",
  "account.learnMore": "Learn more",
  "account.hint": "Account and app preferences",

  "overview.eyebrow": "Workspace",
  "overview.title": "Overview",
  "overview.description":
    "Shipcat routes Claude Desktop requests through ClaudeHarbor's local gateway to the model providers you choose.",
  "overview.hero.eyebrow": "Local first",
  "overview.hero.title": "Configure once, route anywhere",
  "overview.hero.body":
    "Add a provider and a profile in settings, then point Claude Desktop at the local gateway. Credentials and routing stay on this machine.",
  "overview.hero.primary": "Open settings",
  "overview.hero.secondary": "View providers",
  "overview.flow.desktop": "Claude Desktop",
  "overview.flow.gateway": "Local gateway",
  "overview.flow.provider": "Model provider",
  "overview.flow.caption": "Same desktop, any model behind it.",
  "overview.cards.gateway": "Gateway",
  "overview.cards.gatewayBody":
    "Listening address and health appear once the gateway starts.",
  "overview.cards.providers": "Providers",
  "overview.cards.providersBody":
    "Connections and available models are listed on the providers page.",
  "overview.cards.profiles": "Profiles",
  "overview.cards.profilesBody":
    "Profiles bundle a provider, model mapping and fallback order.",
  "overview.cards.usage": "Usage",
  "overview.cards.usageBody":
    "Daily requests and token counts are summarized after syncing.",
  "overview.cards.openSettings": "Open settings",
  "overview.cards.openPage": "View page",
  "overview.value.unknown": "—",
  "overview.note":
    "This is a preview overview. Live figures replace the placeholders once the gateway and usage ledger are connected.",

  "providers.eyebrow": "Routing",
  "providers.title": "Providers",
  "providers.description":
    "Manage the model providers and credentials available to the local gateway.",
  "providers.add": "Add provider",
  "providers.empty.title": "No providers yet",
  "providers.empty.body":
    "Add your first provider in settings. Once the gateway starts, this page will show connection health and available models.",
  "providers.empty.primary": "Open settings",
  "providers.include.title": "What appears here",
  "providers.include.status": "Connection health and the latest probe result",
  "providers.include.models": "Available models and context windows",
  "providers.include.routes": "Routing and fallback order across profiles",
  "providers.note": "Provider configuration is managed locally by Shipcat.",

  "profiles.eyebrow": "Configuration",
  "profiles.title": "Profiles",
  "profiles.description":
    "Combine providers, models and routing rules for different Claude Desktop setups.",
  "profiles.create": "New profile",
  "profiles.empty.title": "No profiles yet",
  "profiles.empty.body":
    "A profile decides which provider and model Claude Desktop uses. Create one in settings to get started.",
  "profiles.empty.primary": "Open settings",
  "profiles.include.title": "A profile contains",
  "profiles.include.provider": "Provider and default model",
  "profiles.include.mapping": "Model mapping and fallback order",
  "profiles.include.notes": "Notes and enabled state",
  "profiles.note": "Switching profiles only affects Claude Desktop on this machine.",

  "usage.eyebrow": "Activity",
  "usage.title": "Usage",
  "usage.description":
    "Review requests and token usage handled by the local gateway.",
  "usage.stats.requests": "Requests",
  "usage.stats.input": "Input tokens",
  "usage.stats.output": "Output tokens",
  "usage.stats.pending": "Shown after sync",
  "usage.chart.title": "Daily usage",
  "usage.chart.range": "Last 7 days",
  "usage.chart.empty": "Nothing to chart yet",
  "usage.empty.title": "No usage records",
  "usage.empty.body":
    "Once the gateway handles requests, daily token and request totals will appear here.",
  "usage.empty.primary": "Open settings",
  "usage.note": "Only requests routed through the local gateway are counted.",

  "common.settings": "Settings",
  "common.placeholder": "—",
  "common.openSettings": "Open settings",
  "common.preview": "Preview",
  "common.dismiss": "Close",
} as const;

export type MessageKey = keyof typeof en;

const zh: Record<MessageKey, string> = {
  "app.name": "Shipcat",
  "app.tagline": "本地网关",
  "app.documentTitle": "{page} · Shipcat",

  "nav.label": "主导航",
  "nav.section": "工作台",
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
  "account.device": "此设备",
  "account.settings": "设置",
  "account.language": "切换语言",
  "account.learnMore": "了解更多",
  "account.hint": "账户与应用偏好",

  "overview.eyebrow": "工作台",
  "overview.title": "概览",
  "overview.description":
    "Shipcat 通过 ClaudeHarbor 本地网关，把 Claude Desktop 的请求路由到你选择的模型供应商。",
  "overview.hero.eyebrow": "本地优先",
  "overview.hero.title": "一次配置，随处路由",
  "overview.hero.body":
    "在设置中添加供应商与档案，再让 Claude Desktop 指向本地网关。凭据与路由都留在这台机器上。",
  "overview.hero.primary": "打开设置",
  "overview.hero.secondary": "查看供应商",
  "overview.flow.desktop": "Claude Desktop",
  "overview.flow.gateway": "本地网关",
  "overview.flow.provider": "模型供应商",
  "overview.flow.caption": "同一个桌面端，背后可以是任意模型。",
  "overview.cards.gateway": "网关",
  "overview.cards.gatewayBody": "网关启动后，这里会显示监听地址与健康状态。",
  "overview.cards.providers": "供应商",
  "overview.cards.providersBody": "连接状态与可用模型会在供应商页列出。",
  "overview.cards.profiles": "档案",
  "overview.cards.profilesBody": "档案组合供应商、模型映射与回退顺序。",
  "overview.cards.usage": "用量",
  "overview.cards.usageBody": "同步后按天汇总请求数与 Token 用量。",
  "overview.cards.openSettings": "打开设置",
  "overview.cards.openPage": "查看页面",
  "overview.value.unknown": "—",
  "overview.note":
    "当前为占位概览。接入网关与用量账本后，实时数据会自动替换占位。",

  "providers.eyebrow": "路由",
  "providers.title": "供应商",
  "providers.description": "管理本地网关可用的模型供应商与凭据。",
  "providers.add": "添加供应商",
  "providers.empty.title": "还没有供应商",
  "providers.empty.body":
    "在设置中添加第一个供应商。网关启动后，这里会显示连接状态与可用模型。",
  "providers.empty.primary": "打开设置",
  "providers.include.title": "此页将显示",
  "providers.include.status": "连接状态与最近一次探测结果",
  "providers.include.models": "可用模型与上下文窗口",
  "providers.include.routes": "档案中的路由与回退顺序",
  "providers.note": "供应商配置由 Shipcat 在本机管理。",

  "profiles.eyebrow": "配置",
  "profiles.title": "档案",
  "profiles.description": "为不同的 Claude Desktop 场景组合供应商、模型与路由规则。",
  "profiles.create": "新建档案",
  "profiles.empty.title": "还没有档案",
  "profiles.empty.body":
    "档案决定 Claude Desktop 使用哪个供应商与模型。先在设置中创建一个档案。",
  "profiles.empty.primary": "打开设置",
  "profiles.include.title": "档案包含",
  "profiles.include.provider": "供应商与默认模型",
  "profiles.include.mapping": "模型映射与回退顺序",
  "profiles.include.notes": "备注与启用状态",
  "profiles.note": "切换档案只会影响这台机器上的 Claude Desktop。",

  "usage.eyebrow": "活动",
  "usage.title": "用量",
  "usage.description": "查看经由本地网关处理的请求与 Token 使用情况。",
  "usage.stats.requests": "请求数",
  "usage.stats.input": "输入 Token",
  "usage.stats.output": "输出 Token",
  "usage.stats.pending": "同步后显示",
  "usage.chart.title": "每日用量",
  "usage.chart.range": "近 7 天",
  "usage.chart.empty": "还没有可绘制的数据",
  "usage.empty.title": "暂无用量记录",
  "usage.empty.body":
    "网关开始处理请求后，这里会显示按天汇总的 Token 与请求数据。",
  "usage.empty.primary": "打开设置",
  "usage.note": "只统计经由本地网关的请求。",

  "common.settings": "设置",
  "common.placeholder": "—",
  "common.openSettings": "打开设置",
  "common.preview": "界面预览",
  "common.dismiss": "关闭",
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
