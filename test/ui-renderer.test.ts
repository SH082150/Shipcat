/**
 * DOM 相关行为（悬停 1s、固定/预览状态机）由 ui-state.test.ts 覆盖；
 * 这里只锁住渲染层可观察的结构与文案，避免测试与实现细节耦合。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  LANGUAGES,
  LANGUAGE_STORAGE_KEY,
  MESSAGES,
  createTranslator,
  detectLanguage,
  isLanguage,
} from "../ui/renderer/components/i18n.ts";
import { escapeHtml, iconSlot } from "../ui/renderer/components/html.ts";
import { NAV_ITEMS } from "../ui/renderer/components/navigation.ts";
import {
  OPEN_SETTINGS_EVENT,
  createOpenSettingsDetail,
  dispatchOpenSettings,
  normalizeOpenSettingsDetail,
} from "../ui/renderer/components/events.ts";
import {
  renderAccountButton,
  renderAccountMenu,
} from "../ui/renderer/components/account-menu.ts";
import { renderSidebar } from "../ui/renderer/components/sidebar.ts";
import type { ClientInfo } from "../ui/renderer/components/events.ts";
import type { Translator } from "../ui/renderer/components/i18n.ts";

import { render as renderOverview } from "../ui/renderer/pages/overview.ts";
import { render as renderProviders } from "../ui/renderer/pages/providers.ts";
import { render as renderProfiles } from "../ui/renderer/pages/profiles.ts";
import { render as renderUsage } from "../ui/renderer/pages/usage.ts";

const read = (relative: string): string =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const clientInfo: ClientInfo = {
  username: "alice",
  hostname: "studio-mac",
};

function translator(language: "zh" | "en"): Translator {
  return createTranslator(language);
}

const EMPTY_USAGE_VIEW = {
  revision: 0,
  lastSyncedAt: null,
  heatmap: [],
  daily: [],
  warnings: [],
};

const PAGES = [
  ["overview", renderOverview],
  ["providers", renderProviders],
  ["profiles", renderProfiles],
  ["usage", (ctx: Parameters<typeof renderUsage>[0]) => renderUsage(ctx, EMPTY_USAGE_VIEW)],
] as const;

const ICON_PLACEHOLDER = /<span class="[^"]*\bicon-placeholder\b[^"]*"[^>]*><\/span>/g;

test("i18n: 中英文案键完全一致，语言归一与插值可预测", () => {
  assert.deepEqual(
    LANGUAGES.map((item) => item.id),
    ["en", "zh"],
  );
  assert.equal(isLanguage("zh"), true);
  assert.equal(isLanguage("en"), true);
  for (const value of ["fr", "", null, undefined, 2]) {
    assert.equal(isLanguage(value), false);
  }

  assert.deepEqual(
    Object.keys(MESSAGES.zh).sort(),
    Object.keys(MESSAGES.en).sort(),
    "中英文案必须一一对应",
  );

  assert.equal(detectLanguage("zh-CN"), "zh");
  assert.equal(detectLanguage("zh-Hant"), "zh");
  assert.equal(detectLanguage("en-US"), "en");
  assert.equal(detectLanguage("fr-FR"), "en");
  assert.equal(detectLanguage(undefined), "en");

  const zh = translator("zh");
  assert.match(zh.t("app.documentTitle", { page: "概览" }), /概览/);
  const en = translator("en");
  assert.equal(en.t("nav.overview"), "Overview");
  assert.equal(en.language, "en");
  assert.equal(LANGUAGE_STORAGE_KEY, "claudeharbor.language");
});

test("html: 动态文本全部转义，图标占位保持空元素", () => {
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  );
  assert.equal(escapeHtml("a&b"), "a&amp;b");

  const icon = iconSlot("nav-icon");
  assert.equal(icon, '<span class="icon-placeholder nav-icon" aria-hidden="true"></span>');
  assert.equal(iconSlot(), '<span class="icon-placeholder" aria-hidden="true"></span>');
});

test("navigation: 四条导航严格对应四个主页面", () => {
  assert.deepEqual(
    NAV_ITEMS.map((item) => item.id),
    ["overview", "providers", "profiles", "usage", "monitor"],
  );
  const zh = translator("zh");
  assert.deepEqual(
    NAV_ITEMS.map((item) => zh.t(item.labelKey)),
    ["概览", "供应商", "档案", "用量", "事件监测"],
  );
  const en = translator("en");
  assert.deepEqual(
    NAV_ITEMS.map((item) => en.t(item.labelKey)),
    ["Overview", "Providers", "Profiles", "Usage", "Monitor"],
  );
  for (const item of NAV_ITEMS) {
    assert.equal(typeof item.hintKey, "string");
  }
});

test("sidebar: 四个导航、底部一体账户、独立齿轮，当前页唯一高亮", () => {
  const html = renderSidebar({
    t: translator("zh"),
    page: "providers",
    language: "zh",
    menuOpen: false,
    clientInfo,
  });

  assert.match(html, /data-role="sidebar"/);
  assert.equal((html.match(/data-page="/g) ?? []).length, 5, "五个导航按钮都应带 data-page");
  for (const page of ["overview", "providers", "profiles", "usage", "monitor"]) {
    assert.match(html, new RegExp(`data-page="${page}"`));
  }
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, /aria-current="page"[\s\S]*?data-page="providers"|data-page="providers"[\s\S]*?aria-current="page"/);

  assert.match(html, /data-role="account-button"/);
  assert.match(html, /data-action="account"/);
  assert.match(html, /alice/);
  assert.match(html, /data-action="settings"[\s\S]*?data-section="general"/);
  assert.match(html, /class="[^"]*sidebar-gear/);
  assert.match(html, /data-role="sidebar-footer"/);

  assert.ok((html.match(/<svg\b/g) ?? []).length >= 5, "导航与齿轮使用真实图标");
  assert.match(html, /icon-placeholder/, "账户头像仍保留空占位");
  assert.doesNotMatch(html, /ClaudeHarbor/, "侧栏顶部品牌已移除");
  assert.doesNotMatch(html, /sidebar-brand/);
  const icons = html.match(ICON_PLACEHOLDER) ?? [];
  assert.equal(
    (html.match(/icon-placeholder/g) ?? []).length,
    icons.length,
    "图标占位元素内部不得绘制内容",
  );
  assert.doesNotMatch(html, /data-action="toggle-sidebar"/, "侧栏按钮属于标题栏，不放进侧栏");
});

test("sidebar: 用户名转义，账户菜单仅在打开时出现且含三项", () => {
  const props = {
    t: translator("en"),
    page: "overview" as const,
    language: "en" as const,
    menuOpen: true,
    clientInfo: { username: '<img src=x onerror="alert(1)">' },
  };
  const open = renderSidebar(props);
  assert.doesNotMatch(open, /<img/i);
  assert.match(open, /&lt;img/);
  assert.match(open, /data-role="account-menu"/);
  assert.match(open, />Settings</);
  assert.match(open, />Language</);
  assert.match(open, />Learn more</);
  assert.match(open, /data-action="open-language"/);
  assert.equal((open.match(/data-language="/g) ?? []).length, 0, "语言选项改由弹窗承载");

  const closed = renderSidebar({ ...props, menuOpen: false });
  assert.doesNotMatch(closed, /data-role="account-menu"/);
  assert.equal(renderAccountMenu({ ...props, t: translator("en"), menuOpen: false }), "");

  const button = renderAccountButton({
    t: translator("en"),
    menuOpen: true,
    clientInfo,
  });
  assert.match(button, /aria-haspopup="menu"/);
  assert.match(button, /aria-expanded="true"/);
});

test("account-menu: 语言项作为入口打开语言弹窗", () => {
  const zh = renderAccountMenu({
    t: translator("zh"),
    menuOpen: true,
    clientInfo,
  });
  assert.match(zh, /data-action="open-language"/);
  assert.match(zh, />设置</);
  assert.match(zh, />切换语言</);
  assert.match(zh, />了解更多</);
  assert.match(
    read("ui/renderer/components/language-modal.ts"),
    /LANGUAGES\.map|for \(const item of LANGUAGES\)/,
    "语言弹窗直接使用 LANGUAGES 列表",
  );
});

test("pages: 四页均可渲染中英文、标题正确、无 SVG 与伪业务数字", () => {
  for (const [id, render] of PAGES) {
    for (const language of ["zh", "en"] as const) {
      const t = translator(language);
      const html = render({ t, language, clientInfo });
      assert.match(html, new RegExp(`data-role="page-${id}"`));
      assert.match(html, /<h1[^>]*>/);
      assert.match(html, /class="[^"]*\bpage\b/);
      assert.match(html, /icon-svg|icon-placeholder/);
      assert.doesNotMatch(html, /<script/i);
      assert.doesNotMatch(html, /onclick=/i);
      assert.doesNotMatch(html, /\b\d{1,3}(?:,\d{3})+\b/, "不得伪造统计数字");
    }
  }

  const overview = renderOverview({ t: translator("zh"), language: "zh", clientInfo });
  assert.match(overview, /data-role="overview-greeting"/);
  assert.match(overview, /data-role="overview-mascot"/);

  const providers = renderProviders({ t: translator("zh"), language: "zh", clientInfo });
  assert.match(providers, /data-role="provider-list"/);
  assert.match(providers, /data-action="add-provider"/);

  const profiles = renderProfiles({ t: translator("en"), language: "en", clientInfo });
  assert.match(profiles, /data-role="page-profiles"/);
  assert.match(profiles, /data-profile-id=/);

  const usage = renderUsage(
    { t: translator("en"), language: "en", clientInfo },
    EMPTY_USAGE_VIEW,
  );
  assert.match(usage, /data-role="usage-heatmap"/);
  assert.match(usage, /data-usage-range=/);
});

test("events: 设置请求带 clientInfo，兼容字符串与对象 detail", () => {
  const detail = createOpenSettingsDetail({
    section: "client-info",
    source: "account-menu",
    clientInfo,
  });
  assert.equal(detail.section, "client-info");
  assert.equal(detail.source, "account-menu");
  assert.equal(detail.clientInfo.username, "alice");
  assert.equal(detail.clientInfo.hostname, "studio-mac");

  assert.equal(normalizeOpenSettingsDetail("client-info").section, "client-info");
  assert.equal(normalizeOpenSettingsDetail("general").section, "general");
  assert.equal(
    normalizeOpenSettingsDetail({ section: "client-info", clientInfo: { username: "bob" } }).clientInfo.username,
    "bob",
  );
  assert.equal(normalizeOpenSettingsDetail(null).section, "general");
  assert.equal(normalizeOpenSettingsDetail({ section: "nope" }).section, "general");

  const scope = globalThis as unknown as { window?: EventTarget };
  const previous = scope.window;
  const target = new EventTarget();
  scope.window = target;
  try {
    let received: CustomEvent | null = null;
    target.addEventListener(OPEN_SETTINGS_EVENT, (event) => {
      received = event as CustomEvent;
    });
    const returned = dispatchOpenSettings({
      section: "client-info",
      source: "sidebar-gear",
      clientInfo,
    });
    assert.equal(OPEN_SETTINGS_EVENT, "open-settings");
    assert.ok(received, "应派发 window 上的 open-settings 事件");
    assert.equal((received as CustomEvent).type, "open-settings");
    assert.equal(
      ((received as CustomEvent).detail as { section: string }).section,
      "client-info",
    );
    assert.equal(returned?.clientInfo.username, "alice");
  } finally {
    if (previous === undefined) delete scope.window;
    else scope.window = previous;
  }
});

test("index.html: 模块入口、样式、设置弹窗样式与拖拽标题栏", () => {
  const index = read("ui/renderer/index.html");
  assert.match(index, /<script[^>]+type="module"[^>]+src="\.\/app\.js"/);
  assert.match(index, /href="\.\/styles\.css"/);
  assert.match(index, /href="\.\/settings\/settings\.css"/);
  assert.match(index, /id="app"/);
  assert.match(index, /lang="zh-CN"/);
  assert.doesNotMatch(index, /<svg/i);
});

test("app.ts: 接线真实状态机、悬停预览、主题、用户名与设置弹窗", () => {
  const app = read("ui/renderer/app.ts");
  assert.match(app, /createSidebar\(/);
  assert.match(app, /pointerEnter\("trigger"\)/);
  assert.match(app, /pointerLeave\("trigger"\)/);
  assert.match(app, /pointerEnter\("panel"\)/);
  assert.match(app, /pointerLeave\("panel"\)/);
  assert.match(app, /createTheme\(/);
  assert.match(app, /createSettingsModal\(/);
  assert.match(app, /getUsername/);
  assert.match(app, /dataset\.theme|data-theme/);
  assert.match(app, /OPEN_SETTINGS_EVENT|open-settings/);
  assert.match(app, /data-action="toggle-sidebar"/);
  assert.match(app, /client-info/);
});

test("styles.css: drag/no-drag、最高层级侧栏按钮、近白近黑令牌与减弱动效", () => {
  const css = read("ui/renderer/styles.css");
  assert.match(css, /-webkit-app-region:\s*drag/);
  assert.match(css, /-webkit-app-region:\s*no-drag/);
  assert.match(css, /\.sidebar-toggle\s*\{[\s\S]*?z-index:\s*100/);
  assert.match(css, /\[data-sidebar="preview"\]/);
  assert.match(css, /\[data-sidebar="pinned"\]/);
  assert.match(css, /\[data-sidebar="collapsed"\]/);
  assert.match(css, /--harbor-bg:\s*#f9f9f7/i);
  assert.match(css, /--harbor-sidebar:\s*#f6f6f4/i);
  assert.match(css, /--harbor-brand:\s*#d97757/i);
  assert.match(css, /--harbor-inverse:\s*#0b0b0b/i);
  assert.match(css, /--harbor-switch-on:\s*#[0-9a-f]{6}/i);
  assert.match(css, /html\[data-theme="dark"\][\s\S]*?--harbor-bg:\s*#151515/i);
  assert.match(css, /\[data-theme="dark"\]/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /--harbor-font-sans:[^;]*Shipcat Sans/i);
});
