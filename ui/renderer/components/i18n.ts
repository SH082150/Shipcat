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
  "nav.monitor": "Limit",
  "nav.monitorHint": "Provider quota queries and live ledger records.",

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

  "monitor.title": "Limit",
  "monitor.description": "Usage summed locally for each reset window your scripts return.",
  "monitor.eyebrow": "ROLLING WINDOWS",
  "monitor.section.events": "Records",
  "monitor.limit.title": "Quota",
  "monitor.limit.description":
    "Scripts provide the windows and reset times; usage is summed from the local database for each window.",
  "monitor.limit.selectLabel": "Quota config",
  "monitor.limit.refresh": "Refresh quota",
  "monitor.limit.emptyProfiles": "No quota query configured yet. Add one on a provider's detail page.",
  "monitor.limit.emptyWindows": "The script returned no windows.",
  "monitor.limit.loading": "Querying…",
  "monitor.limit.error": "Query failed",
  "monitor.limit.resetAfter": "until reset",
  "monitor.limit.remainingPct": "Remaining {percent}%",
  "monitor.limit.totalUsage": "Total tokens",
  "monitor.limit.cacheHit": "Cache hit",
  "monitor.limit.noReset": "The script returned no reset time, so local usage cannot be summed.",
  "monitor.limit.truncated": "Local records hit the 50,000-row cap; window usage may be undercounted.",
  "monitor.limit.balance": "Balance",
  "monitor.limit.windowTitle.5h": "5 hours usage",
  "monitor.limit.windowTitle.7d": "7 days usage",
  "monitor.limit.windowTitle.30d": "30 days usage",
  "monitor.limit.testOk": "Query succeeded: {summary}",
  "monitor.limit.testEmpty": "Query succeeded but returned no windows or balance.",
  "monitor.limit.testUsed": "used {value}",
  "monitor.limit.testLimit": "limit {value}",
  "monitor.limit.testRemaining": "remaining {value}",
  "monitor.limit.testReset": "reset {value}",
  "monitor.limit.testBalance": "balance {value}",
  "monitor.limit.testTesting": "Testing…",
  "monitor.limit.testFailed": "Query failed.",
  "monitor.summary.cost": "Cost",
  "monitor.summary.costHint": "Not calculated yet",
  "monitor.summary.tokens": "Total tokens",
  "monitor.summary.tokensHint": "Sum of the records below",
  "monitor.summary.records": "records",
  "monitor.summary.hitRate": "Cache hit rate",
  "monitor.summary.hitRateHint": "Cache reads / cacheable input",
  "monitor.tab.all": "All",
  "monitor.col.time": "Time",
  "monitor.col.type": "Type",
  "monitor.col.surface": "Surface",
  "monitor.col.providers": "Providers",
  "monitor.col.models": "Models",
  "monitor.col.input": "New input",
  "monitor.col.cacheRead": "Cache read",
  "monitor.col.output": "Output",
  "monitor.col.tools": "Tool calls",
  "monitor.col.hitRate": "Hit rate",
  "monitor.col.status": "Status",
  "monitor.status.ok": "OK",
  "monitor.status.error": "Error",
  "monitor.search.placeholder": "Search records",
  "monitor.search.aria": "Search records",
  "monitor.search.close": "Close search",
  "monitor.refresh": "Refresh records",
  "monitor.tabs.aria": "Filter by surface",
  "monitor.list.aria": "Usage records",
  "monitor.prev": "Previous page",
  "monitor.next": "Next page",
  "monitor.page.jump": "Jump to page",
  "monitor.page.input": "Page number",
  "monitor.dialog.close": "Close",
  "monitor.empty.title": "No records yet",
  "monitor.empty.body": "Monitor is watching the ledger; new records appear here automatically.",
  "monitor.empty.filteredTitle": "No matching records",
  "monitor.empty.filteredBody": "Adjust the search or filter and try again.",
  "monitor.detail.title": "Record detail",
  "monitor.detail.time": "Time",
  "monitor.detail.surface": "Surface",
  "monitor.detail.origin": "Origin",
  "monitor.detail.status": "Status",
  "monitor.detail.session": "Session ID",
  "monitor.detail.event": "Event ID",
  "monitor.detail.routes": "Provider / upstream model",
  "monitor.detail.input": "Input tokens",
  "monitor.detail.output": "Output tokens",
  "monitor.detail.cacheRead": "Cache read",
  "monitor.detail.cacheWrite": "Cache write",
  "monitor.detail.hitRate": "Cache hit rate",
  "monitor.detail.tools": "Tool calls",
  "monitor.detail.sessionEmpty": "None (background record)",
  "monitor.detail.none": "None",
  "monitor.detail.raw": "Official JSON",
  "monitor.detail.rawEmpty": "No raw line stored for this record.",

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
  "nav.monitor": "额度",
  "nav.monitorHint": "供应商额度查询与实时账本记录。",

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

  "monitor.title": "额度",
  "monitor.description": "按脚本返回的重置窗口，统计本地记录的消耗与缓存命中率。",
  "monitor.eyebrow": "滚动窗口",
  "monitor.section.events": "事件记录",
  "monitor.limit.title": "额度",
  "monitor.limit.description": "脚本只提供窗口与重置时间；每个窗口的用量按本地数据库统计。",
  "monitor.limit.selectLabel": "额度配置",
  "monitor.limit.refresh": "刷新额度",
  "monitor.limit.emptyProfiles": "还没有额度查询配置，去供应商详情页添加。",
  "monitor.limit.emptyWindows": "脚本没有返回任何窗口。",
  "monitor.limit.loading": "正在查询…",
  "monitor.limit.error": "查询失败",
  "monitor.limit.resetAfter": "后重置",
  "monitor.limit.remainingPct": "剩余 {percent}%",
  "monitor.limit.totalUsage": "总消耗",
  "monitor.limit.cacheHit": "缓存命中",
  "monitor.limit.noReset": "脚本没有返回重置时间，无法统计本地用量。",
  "monitor.limit.truncated": "本地记录达到 5 万条上限，窗口用量可能偏小。",
  "monitor.limit.balance": "余额",
  "monitor.limit.windowTitle.5h": "5 小时用量",
  "monitor.limit.windowTitle.7d": "7 天用量",
  "monitor.limit.windowTitle.30d": "30 天用量",
  "monitor.limit.testOk": "查询成功：{summary}",
  "monitor.limit.testEmpty": "查询成功，但没有返回窗口或余额。",
  "monitor.limit.testUsed": "已用 {value}",
  "monitor.limit.testLimit": "上限 {value}",
  "monitor.limit.testRemaining": "剩余 {value}",
  "monitor.limit.testReset": "重置 {value}",
  "monitor.limit.testBalance": "余额 {value}",
  "monitor.limit.testTesting": "正在测试…",
  "monitor.limit.testFailed": "查询失败。",
  "monitor.summary.cost": "花费",
  "monitor.summary.costHint": "暂未计算",
  "monitor.summary.tokens": "总消耗 Token",
  "monitor.summary.tokensHint": "下方记录合计",
  "monitor.summary.records": "条记录合计",
  "monitor.summary.hitRate": "缓存命中率",
  "monitor.summary.hitRateHint": "缓存读取 / 可缓存输入",
  "monitor.tab.all": "全部",
  "monitor.col.time": "时间",
  "monitor.col.type": "类型",
  "monitor.col.surface": "模块",
  "monitor.col.providers": "供应商",
  "monitor.col.models": "模型",
  "monitor.col.input": "新增输入",
  "monitor.col.cacheRead": "缓存读取",
  "monitor.col.output": "输出",
  "monitor.col.tools": "工具调用",
  "monitor.col.hitRate": "本轮命中率",
  "monitor.col.status": "状态",
  "monitor.status.ok": "正常",
  "monitor.status.error": "异常",
  "monitor.search.placeholder": "搜索记录",
  "monitor.search.aria": "搜索记录",
  "monitor.search.close": "关闭搜索",
  "monitor.refresh": "刷新记录",
  "monitor.tabs.aria": "按模块筛选",
  "monitor.list.aria": "用量记录",
  "monitor.prev": "上一页",
  "monitor.next": "下一页",
  "monitor.page.jump": "跳转到页码",
  "monitor.page.input": "页码",
  "monitor.dialog.close": "关闭",
  "monitor.empty.title": "还没有记录",
  "monitor.empty.body": "监视器正在监听账本，新记录会自动出现在这里。",
  "monitor.empty.filteredTitle": "没有符合条件的记录",
  "monitor.empty.filteredBody": "调整搜索或筛选条件后再试。",
  "monitor.detail.title": "记录详情",
  "monitor.detail.time": "时间",
  "monitor.detail.surface": "模块",
  "monitor.detail.origin": "记录类型",
  "monitor.detail.status": "状态",
  "monitor.detail.session": "会话 ID",
  "monitor.detail.event": "事件 ID",
  "monitor.detail.routes": "供应商 / 上游模型",
  "monitor.detail.input": "输入 Token",
  "monitor.detail.output": "输出 Token",
  "monitor.detail.cacheRead": "缓存读取",
  "monitor.detail.cacheWrite": "缓存写入",
  "monitor.detail.hitRate": "本轮缓存命中率",
  "monitor.detail.tools": "工具调用",
  "monitor.detail.sessionEmpty": "无（后台记录）",
  "monitor.detail.none": "无",
  "monitor.detail.raw": "官方完整 JSON",
  "monitor.detail.rawEmpty": "该历史记录未保留原始行。",

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
