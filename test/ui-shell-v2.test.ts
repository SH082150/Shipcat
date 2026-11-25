import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DETAIL_PAGES,
  parseRoute,
  routeHash,
  sameRoute,
} from "../ui/renderer/state/navigation.ts";
import {
  SETTINGS_SECTIONS,
  createOpenSettingsDetail,
  normalizeOpenSettingsDetail,
  normalizeSettingsSection,
} from "../ui/renderer/components/events.ts";
import { resolvePageExport } from "../ui/renderer/components/ui-actions.ts";
import { renderSidebar } from "../ui/renderer/components/sidebar.ts";
import { createTranslator } from "../ui/renderer/components/i18n.ts";
import * as providersPage from "../ui/renderer/pages/providers.ts";
import * as profilesPage from "../ui/renderer/pages/profiles.ts";
import * as usagePage from "../ui/renderer/pages/usage.ts";

const read = (relative: string): string =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");


test("route: 详情页只允许 providers/profiles，解析与回写稳定", () => {
  assert.deepEqual([...DETAIL_PAGES], ["providers", "profiles"]);

  assert.deepEqual(parseRoute("#providers/openai"), {
    page: "providers",
    detailId: "openai",
  });
  assert.deepEqual(parseRoute("profiles/daily%20use"), {
    page: "profiles",
    detailId: "daily use",
  });
  assert.deepEqual(parseRoute("#profiles/%E5%B7%A5%E4%BD%9C"), {
    page: "profiles",
    detailId: "工作",
  });
  assert.deepEqual(parseRoute("#overview/team"), {
    page: "overview",
    detailId: null,
  });
  assert.deepEqual(parseRoute("#usage/7d"), {
    page: "usage",
    detailId: null,
  });
  assert.deepEqual(parseRoute("#providers/"), {
    page: "providers",
    detailId: null,
  });
  assert.deepEqual(parseRoute("#providers/a/b"), {
    page: "providers",
    detailId: null,
  });
  assert.deepEqual(parseRoute(null), { page: "overview", detailId: null });
  assert.equal(parseRoute("#providers/%E0%A4%A").detailId, null);
  assert.equal(parseRoute(`#providers/${"a".repeat(129)}`).detailId, null);
  assert.equal(parseRoute("#providers/..").detailId, null);
  assert.equal(parseRoute("#providers/%00").detailId, null);

  assert.equal(routeHash({ page: "providers", detailId: "a b" }), "#providers/a%20b");
  assert.equal(routeHash({ page: "overview", detailId: "ignored" }), "#overview");
  assert.equal(routeHash({ page: "providers", detailId: null }), "#providers");

  assert.equal(
    sameRoute(parseRoute("#providers/x"), { page: "providers", detailId: "x" }),
    true,
  );
  assert.equal(
    sameRoute(parseRoute("#providers/x"), { page: "providers", detailId: "y" }),
    false,
  );
  assert.equal(sameRoute(null, { page: "overview", detailId: null }), false);
});

test("settings: section 覆盖五个章节，未知值仍回落到 general", () => {
  assert.deepEqual(
    [...SETTINGS_SECTIONS],
    ["general", "privacy", "usage", "system", "about", "client-info"],
  );

  for (const section of SETTINGS_SECTIONS) {
    assert.equal(normalizeSettingsSection(section), section);
  }
  assert.equal(normalizeSettingsSection("nope"), "general");
  assert.equal(normalizeSettingsSection(null), "general");
  assert.equal(normalizeSettingsSection(42), "general");

  assert.equal(createOpenSettingsDetail({ section: "privacy" }).section, "privacy");
  assert.equal(createOpenSettingsDetail({ section: "system" }).section, "system");
  assert.equal(normalizeOpenSettingsDetail("usage").section, "usage");
  assert.equal(normalizeOpenSettingsDetail({ section: "privacy" }).section, "privacy");
  assert.equal(normalizeOpenSettingsDetail({ section: "privacy" }).source, "renderer");
});

test("ui-actions: 页面导出解析可预测", () => {
  const renderDetail = () => "<div></div>";
  assert.equal(
    resolvePageExport({ renderDetail }, "renderDetail"),
    renderDetail,
  );
  assert.equal(resolvePageExport({ renderDetail: "not-a-function" }, "renderDetail"), null);
  assert.equal(resolvePageExport({}, "renderDetail"), null);
  assert.equal(resolvePageExport(null, "renderDetail"), null);
  assert.equal(resolvePageExport(undefined, "renderDetail"), null);
});

test("page contract: 详情、字段弹窗与热力图导出满足 shell 适配器", () => {
  const t = createTranslator("zh");
  const context = { t, language: "zh" as const, clientInfo: {} };

  assert.equal(typeof providersPage.renderDetail, "function");
  assert.equal(typeof profilesPage.renderDetail, "function");
  assert.equal(typeof profilesPage.renderClaudeFieldEntry, "function");
  assert.equal(typeof usagePage.renderHeatmap, "function");

  const provider = providersPage.DEMO_PROVIDERS[0];
  assert.ok(provider, "providers 页应提供演示行以验证详情路由");
  const providerHtml = providersPage.renderDetail(context, provider.id);
  assert.match(providerHtml, /data-role="page-provider-detail"/);
  assert.match(providerHtml, /data-page="providers"/);

  const profile = profilesPage.demoProfiles.profiles[0];
  assert.ok(profile, "profiles 页应提供演示档案以验证详情路由");
  const profileHtml = profilesPage.renderDetail(context, profile.id);
  assert.match(profileHtml, /data-role="page-profile-detail"/);
  assert.match(profileHtml, /data-action="add-field"/);

  const heatmap = usagePage.renderHeatmap("1h");
  assert.match(heatmap, /data-role="usage-heatmap"/);
  assert.match(heatmap, /data-usage-range="1h"/);
});

test("sidebar v2: 顶部品牌移除，四导航与底部结构保留", () => {
  const html = renderSidebar({
    t: createTranslator("zh"),
    page: "profiles",
    language: "zh",
    menuOpen: false,
    clientInfo: { username: "alice" },
  });

  assert.match(html, /data-role="sidebar"/);
  assert.match(html, /data-role="sidebar-nav"/);
  assert.match(html, /data-role="sidebar-footer"/);
  assert.doesNotMatch(html, /data-role="sidebar-brand"/);
  assert.doesNotMatch(html, /sidebar-brand/);
  assert.doesNotMatch(html, /brand-name/);
  assert.doesNotMatch(html, /brand-tagline/);
  assert.doesNotMatch(html, /ClaudeHarbor/);
  assert.doesNotMatch(html, /class="brand-copy"/);

  assert.equal((html.match(/data-page="/g) ?? []).length, 5);
  for (const page of ["overview", "providers", "profiles", "usage", "monitor"]) {
    assert.match(html, new RegExp(`data-page="${page}"`));
  }
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, /data-role="account-button"/);
  assert.match(html, /data-action="settings"/);

  assert.ok((html.match(/<svg\b/g) ?? []).length >= 5, "导航与齿轮使用真实图标");
  const iconCount = (html.match(/icon-placeholder/g) ?? []).length;
  assert.equal(
    (html.match(/<span class="[^"]*\bicon-placeholder\b[^"]*"[^>]*><\/span>/g) ?? []).length,
    iconCount,
    "图标占位必须保持空元素",
  );
});

test("index.html: 引入页面样式、设置样式与模块入口", () => {
  const index = read("ui/renderer/index.html");
  const hrefs = [
    "./styles.css",
    "./settings/settings.css",
    "./pages/overview.css",
    "./pages/providers.css",
    "./pages/profiles.css",
    "./pages/usage.css",
  ];
  for (const href of hrefs) {
    assert.ok(index.includes(`href="${href}"`), `index.html 缺少 ${href}`);
  }
  assert.match(index, /<script[^>]+type="module"[^>]+src="\.\/app\.js"/);
  assert.match(index, /id="app"/);
  assert.doesNotMatch(index, /<svg/i);
  assert.doesNotMatch(index, /\son[a-z]+=/i);
});

test("app shell v2: 详情路由与通用页面动作接线，且保留侧栏状态机", () => {
  const app = read("ui/renderer/app.ts");

  assert.match(app, /parseRoute\(/);
  assert.match(app, /routeHash\(/);
  assert.match(app, /providersModule,\s*"renderDetail"/);
  assert.match(app, /profilesModule,\s*"renderDetail"/);
  assert.match(app, /renderer\(context, detailId\)/);
  assert.match(app, /renderClaudeFieldEntry/);
  assert.match(app, /usageApi\.getView/);
  assert.match(app, /case "search-toggle":/);
  assert.match(app, /case "add-field":/);
  assert.match(app, /handleUsageControl/);
  assert.match(app, /updateUsageView/);
  assert.match(app, /workspace\.dataset\.viewDetail/);
  assert.match(app, /data-action="toggle-sidebar"/);
  assert.match(app, /data-usage-range/);

  assert.match(app, /createSidebar\(/);
  assert.match(app, /pointerEnter\("trigger"\)/);
  assert.match(app, /pointerLeave\("trigger"\)/);
  assert.match(app, /pointerEnter\("panel"\)/);
  assert.match(app, /pointerLeave\("panel"\)/);
  assert.match(app, /createTheme\(/);
  assert.match(app, /createSettingsModal\(/);
  assert.match(app, /OPEN_SETTINGS_EVENT|open-settings/);

  assert.doesNotMatch(app, /brand-name|brand-tagline|sidebar-brand/);
});

test("styles v2: 近白/近黑 tokens、反色主按钮、蓝色开关与基础类", () => {
  const css = read("ui/renderer/styles.css");

  assert.match(css, /--harbor-bg:\s*#f9f9f7/i);
  assert.match(
    css,
    /html\[data-theme="dark"\][\s\S]*?--harbor-bg:\s*#151515/i,
  );
  assert.match(css, /--harbor-inverse:\s*#0b0b0b/i);
  assert.match(css, /--harbor-inverse-text:\s*#ffffff/i);
  assert.match(css, /--harbor-switch-on:\s*#2a78d6/i);
  assert.match(
    css,
    /html\[data-theme="dark"\][\s\S]*?--harbor-inverse:\s*#ffffff/i,
  );
  assert.match(
    css,
    /html\[data-theme="dark"\][\s\S]*?--harbor-inverse-text:\s*#0b0b0b/i,
  );
  assert.match(css, /--harbor-switch-on:\s*#[0-9a-f]{6}/i);

  for (const selector of [".icon-button", ".icon-placeholder", ".nav-item", ".page-header"]) {
    assert.ok(css.includes(selector), `缺少基础类 ${selector}`);
  }

  assert.match(css, /1px solid var\(--harbor-border\)/);
  assert.match(css, /-webkit-app-region:\s*drag/);
  assert.match(css, /-webkit-app-region:\s*no-drag/);
  assert.match(css, /prefers-reduced-motion/);
});
