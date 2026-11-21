/**
 * 渲染函数只返回字符串；交互由 app.ts 的事件委托处理。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createTranslator } from "../ui/renderer/components/i18n.ts";
import type { ClientInfo } from "../ui/renderer/components/events.ts";
import type { PageContext } from "../ui/renderer/pages/types.ts";
import {
  renderClaudeFieldEntry,
  demoProfiles,
  profileHref,
  render,
  renderAddModelEntry,
  renderDetail,
} from "../ui/renderer/pages/profiles.ts";
import type { ProfilesDemo } from "../ui/renderer/pages/profiles.ts";
import { DEMO_PROVIDERS } from "../ui/renderer/pages/providers.ts";

const read = (relative: string): string =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const clientInfo: ClientInfo = { username: "alice" };

function context(language: "zh" | "en" = "zh"): PageContext {
  return { t: createTranslator(language), language, clientInfo };
}

function profileByMode(mode: "standard" | "readOnly" | "advanced") {
  const profile = demoProfiles.profiles.find((item) => item.mode === mode);
  assert.ok(profile, `演示数据缺少 ${mode}`);
  return profile;
}

function elementTag(html: string, pattern: RegExp): string {
  return html.match(pattern)?.[0] ?? "";
}

function inputTag(html: string, field: string): string {
  return elementTag(html, new RegExp(`<input[^>]*data-field="${field}"[^>]*>`));
}

function selectTag(html: string, field: string): string {
  return elementTag(html, new RegExp(`<select[^>]*data-field="${field}"[^>]*>`));
}

function buttonTag(html: string, action: string): string {
  return elementTag(
    html,
    new RegExp(`<button[^>]*data-action="${action}"[^>]*>[\\s\\S]*?</button>`),
  );
}

function block(source: string, selector: string): string {
  const start = source.indexOf(selector);
  assert.ok(start >= 0, `缺少选择器 ${selector}`);
  const end = source.indexOf("}", start);
  return source.slice(start, end < 0 ? undefined : end + 1);
}

function profileRow(html: string, id: string): string {
  const match = new RegExp(
    `<div class="profile-row profile-grid"[^>]*data-profile-id="${id}"[^>]*>[\\s\\S]*?</div>`,
  ).exec(html);
  assert.ok(match, `缺少 ${id} 的列表行`);
  return match[0];
}

/* ------------------------------------------------------------------ */
/* 列表                                                                */
/* ------------------------------------------------------------------ */

test("profiles v2 列表：标题、搜索/添加按钮与当前激活区（排序已移除）", () => {
  const html = render(context("zh"));

  assert.match(html, /data-role="page-profiles"/);
  assert.match(html, /<h1[^>]*>档案<\/h1>/);
  assert.match(html, /data-action="search-profiles"/);
  assert.doesNotMatch(html, /data-action="sort-profiles"/, "排序按钮已移除");
  assert.match(html, /data-action="create-profile"/);
  assert.match(html, /添加档案/);
  assert.match(html, /data-role="active-profile"/);
  assert.match(html, /class="profiles-hero"/);

  const active = demoProfiles.profiles.find((item) => item.id === demoProfiles.activeId);
  assert.ok(active);
  assert.match(html, new RegExp(`data-role="active-profile"[\\s\\S]*?${active.name}`));
  assert.equal(active.mode, "advanced", "演示数据默认激活高级配置以便展示网关控制条");
});

test("添加档案页：模型区是标题行+右侧按钮，点击后插入空白内联条目", () => {
  const html = renderDetail(context("zh"), "new");

  assert.match(html, /data-role="page-profile-add"/);
  assert.match(html, /<h1>添加档案<\/h1>/);
  assert.match(html, /data-role="profile-mode"/);
  assert.match(html, /<option value="standard" selected>标准直连<\/option>/);
  assert.match(html, /<option value="advanced">网关路由<\/option>/);

  // 模型区初始只有标题行与右侧“添加模型”按钮，不预置标题条目。
  assert.match(html, /<h2 id="profile-create-models">模型<\/h2>/);
  assert.match(
    html,
    /<div class="profile-section-tools">\s*<span class="profile-count" data-role="profile-add-model-count">0 项<\/span>\s*<button type="button" class="profile-button profile-button--ghost profile-section-action" data-action="add-profile-model">/,
  );
  assert.match(html, /data-role="profile-add-model-list"><\/div>/);
  assert.doesNotMatch(html, /profile-button--dashed/);
  assert.doesNotMatch(html, /未命名模型/);

  // 空白条目由按钮插入，供应商为现有供应商下拉。
  const entry = renderAddModelEntry(0, "zh");
  assert.match(entry, /<details class="profile-model profile-add-model-entry"[^>]* open>/);
  assert.match(entry, /data-role="model-summary-name">未命名模型</);
  assert.match(entry, /data-role="model-summary-tier" hidden/);
  assert.match(entry, /data-role="model-summary-1m" hidden>1M</);
  assert.match(entry, /data-action="remove-add-model"/);
  assert.match(entry, /aria-label="删除模型"/);
  assert.match(entry, /data-field="modelName"/);
  assert.match(entry, /data-field="supports1m"/);
  assert.doesNotMatch(entry, /data-field="prefer1m"/, "1M 只保留支持开关");
  assert.match(entry, /data-field="anthropicFamilyTier"/);
  assert.match(entry, /data-field="maxEffort"/);
  assert.match(entry, /<select class="profile-input profile-select" data-field="provider">/);
  assert.match(entry, /<option value="">选择供应商<\/option>/);
  for (const provider of DEMO_PROVIDERS) {
    assert.ok(
      entry.includes(`<option value="${provider.id}">${provider.name}</option>`),
      `缺少供应商 ${provider.name}`,
    );
  }
  assert.doesNotMatch(entry, /<input[^>]*data-field="provider"/, "供应商不得是文本输入");
  assert.match(entry, /profile-add-advanced/);

  assert.match(html, /data-action="create-profile-submit"/);
  assert.match(html, />添加<\/button>/);
  assert.doesNotMatch(html, /data-action="delete-profile"/);

  const css = read("ui/renderer/pages/profiles.css");
  assert.match(css, /\[data-role="page-profile-add"\]\[data-mode="standard"\] \.profile-add-advanced\s*\{[\s\S]*?display:\s*none/);
});

test("profiles v2 列表：名称 / 类型 / 状态三列，不重复显示名称与档案名称", () => {
  const html = render(context("zh"));
  const rows = html.match(/class="profile-row profile-grid"/g) ?? [];
  assert.equal(rows.length, demoProfiles.profiles.length);

  for (const profile of demoProfiles.profiles) {
    assert.equal("configName" in profile, false, "ProfileDraft 不应再有 configName");
    assert.match(html, new RegExp(`href="#profiles/${profile.id}"`));
    assert.match(html, new RegExp(`data-profile-id="${profile.id}"`));
    assert.match(html, new RegExp(`data-type="${profile.mode}"`));

    const row = profileRow(html, profile.id);
    const nameCell = elementTag(row, /<span class="profile-row-name">[\s\S]*?<\/span>/);
    assert.equal((row.match(/class="profile-row-name"/g) ?? []).length, 1);
    assert.match(nameCell, new RegExp(profile.name));
    assert.match(row, /class="profile-row-name"/);
    assert.match(row, /class="profile-row-type"/);
    assert.match(row, /class="profile-row-status"/);
    assert.doesNotMatch(row, /profile-row-config|profile-row-mode|profile-row-current/);
  }

  assert.match(html, /<div class="profile-list-head"/);
  const head = elementTag(html, /<div class="profile-list-head"[\s\S]*?<\/div>/);
  assert.match(head, /名称/);
  assert.match(head, />类型</);
  assert.match(head, /Status|状态/);
  assert.doesNotMatch(head, /档案名称|模式|激活/);
  assert.doesNotMatch(html, /配置名称/);
  assert.doesNotMatch(html, /Claude Desktop · (直连|网关|团队共享|备用)/);
});

test("profiles v2 列表：状态列独立显示已激活/未激活/只读", () => {
  const html = render(context("zh"));

  for (const profile of demoProfiles.profiles) {
    const row = profileRow(html, profile.id);
    const status = elementTag(row, /<span class="profile-row-status">[\s\S]*?<\/span>/);
    assert.ok(status.length > 0, `${profile.id} 缺少状态列`);
    if (profile.mode === "readOnly") {
      assert.match(status, /data-status="readonly"/);
      assert.doesNotMatch(status, /apply-profile|>只读<|>—</);
    } else if (profile.id === demoProfiles.activeId) {
      assert.match(status, /已激活/);
      assert.match(status, /✓/);
    } else {
      assert.match(status, /data-action="apply-profile"/);
      assert.match(status, />应用</);
    }
  }

  assert.match(html, /data-applied="true"/);
  assert.match(html, /data-applied="false"/);
});

test("profiles v2 列表：advanced 激活时显示蓝色开关控制条，standard 不显示", () => {
  const advanced = render(context("zh"));
  assert.match(advanced, /data-role="gateway-bar"/);
  assert.match(advanced, /data-role="gateway-switch"/);
  assert.match(advanced, /data-role="gateway-switch"[^>]*type="checkbox"|type="checkbox"[^>]*data-role="gateway-switch"/);
  assert.match(advanced, /data-role="gateway-switch"[^>]*checked|checked[^>]*data-role="gateway-switch"/);
  assert.match(advanced, /端口 4318/);
  assert.match(advanced, /Bearer Token/);

  const standard = profileByMode("standard");
  const standardActive: ProfilesDemo = { ...demoProfiles, activeId: standard.id };
  const standardHtml = render(context("zh"), standardActive);
  assert.match(standardHtml, /data-role="active-profile"/);
  assert.match(standardHtml, /Anthropic 官方/);
  assert.doesNotMatch(standardHtml, /data-role="gateway-bar"/);
  assert.doesNotMatch(standardHtml, /data-role="gateway-switch"/);

  const none: ProfilesDemo = { ...demoProfiles, activeId: null };
  const noneHtml = render(context("zh"), none);
  assert.match(noneHtml, /data-role="active-profile"/);
  assert.match(noneHtml, /未激活/);
  assert.doesNotMatch(noneHtml, /data-role="gateway-bar"/);
});

test("profiles v2 列表：激活区是名称+模式标签卡片，含网关条与模型行", () => {
  const html = render(context("zh"));
  const active = demoProfiles.profiles.find((item) => item.id === demoProfiles.activeId);
  assert.ok(active);
  const section = elementTag(
    html,
    /<section class="profiles-band profiles-active"[\s\S]*?<\/section>/,
  );

  assert.match(section, /class="profiles-gutter">\s*<div class="profiles-hero">/);
  assert.match(section, new RegExp(active.name));
  assert.match(section, /class="profiles-hero-tag">网关路由<\/span>/);
  assert.match(section, /DeepSeek → deepseek-chat/);
  assert.match(section, /data-role="gateway-bar"/);
  const modelRows = section.match(/class="profiles-hero-model"/g) ?? [];
  assert.equal(modelRows.length, active.models?.length ?? 0);
});

test("profiles v2 列表：动态文本转义、图标占位为空、无内联脚本", () => {
  const evil: ProfilesDemo = {
    activeId: "evil",
    gatewayEnabled: true,
    profiles: [
      {
        id: "evil",
        name: '<img src=x onerror="alert(1)">',
        mode: "advanced",
        applied: true,
        port: 4318,
        gatewayToken: "<b>token</b>",
        gatewayAuthScheme: "bearer",
        models: [
          {
            name: "<i>model</i>",
            labelOverride: "<u>label</u>",
            providerName: "<em>provider</em>",
            upstreamModel: "<strong>upstream</strong>",
          },
        ],
      },
    ],
  };

  const html = render(context("zh"), evil);
  const detail = renderDetail(context("zh"), "evil", evil);

  for (const output of [html, detail]) {
    assert.doesNotMatch(output, /<img|<script|<i>|<u>|<em>|<strong>|<b>/i);
    assert.match(output, /&lt;img/);
    assert.doesNotMatch(output, /\son(?:click|error)\s*=\s*["']/i);
    const icons = output.match(/<span class="[^"]*\bicon-placeholder\b[^"]*"[^>]*><\/span>/g) ?? [];
    assert.equal((output.match(/icon-placeholder/g) ?? []).length, icons.length, "占位元素内部不得绘制内容");
    for (const tag of output.match(/<svg\b[^>]*>/g) ?? []) {
      assert.match(tag, /aria-hidden="true"/, "图标 SVG 不应被读屏重复朗读");
    }
  }
});

/* ------------------------------------------------------------------ */
/* 详情                                                                */
/* ------------------------------------------------------------------ */

test("profiles v2 详情：返回、名称、类型、状态、模式与高级字段", () => {
  const profile = profileByMode("advanced");
  const html = renderDetail(context("zh"), profile.id);

  assert.match(html, /data-role="page-profile-detail"/);
  assert.match(html, new RegExp(`data-profile-id="${profile.id}"`));
  assert.match(html, /data-action="profiles-back"/);
  assert.match(html, /href="#profiles"/);
  assert.match(html, new RegExp(`<h1[^>]*>${profile.name}</h1>`));
  assert.match(html, /data-type="advanced"/);
  assert.match(html, /已激活/);
  assert.doesNotMatch(html, /配置名称/);
  assert.doesNotMatch(html, /data-field="configName"/);
  assert.match(html, /data-field="mode"/);
  assert.match(html, /网关路由/);

  assert.match(html, /data-field="port"/);
  assert.match(html, /data-field="gatewayToken"/);
  assert.match(html, /data-field="gatewayAuthScheme"/);
  assert.match(html, /4318/);

  assert.ok(buttonTag(html, "add-field").length > 0, "Claude 透传标题行需要添加项按钮");
  assert.match(buttonTag(html, "add-field"), /添加项/);
  assert.ok(!/disabled/.test(buttonTag(html, "add-field")), "高级配置的添加项应可用");
  assert.match(html, /Claude 透传[\s\S]*?data-action="add-field"[\s\S]*?添加项/, "按钮应位于 Claude 透传标题行");

  assert.match(html, /data-role="savebar"/);
  assert.ok(buttonTag(html, "save-profile").length > 0);
  assert.match(buttonTag(html, "save-profile"), /保存修改/);
  assert.equal((html.match(/data-role="model-item"/g) ?? []).length, profile.models?.length ?? 0);
  assert.match(html, /添加模型/);
});

test("profiles v2 详情：模型区按钮在标题行最右侧，空状态提示还没有模型", () => {
  const advanced = profileByMode("advanced");
  const html = renderDetail(context("zh"), advanced.id);
  assert.match(
    html,
    /<div class="profile-section-tools">\s*<span class="profile-count" data-role="profile-detail-model-count">2 项<\/span>\s*<button type="button" class="profile-button profile-button--ghost profile-section-action" data-action="add-model">/,
  );

  const emptyData: ProfilesDemo = {
    ...demoProfiles,
    profiles: [
      ...demoProfiles.profiles,
      { id: "prf-empty", name: "空档案", mode: "standard", applied: false, models: [] },
    ],
  };
  const emptyHtml = renderDetail(context("zh"), "prf-empty", emptyData);
  assert.match(emptyHtml, /data-role="profile-detail-model-count">0 项</);
  assert.match(emptyHtml, /profile-models-empty">还没有模型</);
  assert.doesNotMatch(emptyHtml, /profile-button--dashed/);
});

test("profiles v2 详情：透传区标题行有添加项，草稿行左项右值各半", () => {
  const html = renderDetail(context("zh"), profileByMode("advanced").id);
  assert.match(
    html,
    /<h2 id="profile-claude-title">Claude 透传<\/h2>[\s\S]*?<div class="profile-section-tools">\s*<span class="profile-count" data-role="profile-claude-count">0 项<\/span>\s*<button type="button" class="profile-button profile-button--ghost profile-section-action" data-action="add-field">/,
  );
  assert.match(html, /data-role="profile-claude-list"/);
  assert.match(html, /profile-claude-empty">没有自定义透传字段。</);

  const entry = renderClaudeFieldEntry("zh");
  assert.match(entry, /data-role="claude-field-entry"/);
  assert.match(entry, /class="profile-input profile-claude-input" type="text" data-field="claudeKey"/);
  assert.match(entry, /class="profile-input profile-claude-input" type="text" data-field="claudeValue"/);
  assert.match(entry, /data-action="remove-claude-draft"/);
  assert.match(entry, /aria-label="删除条目"/);
});

test("profiles v2 详情：模型项可展开并包含按模式显示的字段", () => {
  const standard = profileByMode("standard");
  const advanced = profileByMode("advanced");
  const readOnly = profileByMode("readOnly");

  const advancedHtml = renderDetail(context("zh"), advanced.id);
  for (const field of [
    "modelName",
    "labelOverride",
    "provider",
    "upstreamModel",
    "supports1m",
    "anthropicFamilyTier",
    "isFamilyDefault",
    "behavesAs",
    "maxEffort",
  ]) {
    assert.ok(
      inputTag(advancedHtml, field).length > 0 ||
        selectTag(advancedHtml, field).length > 0 ||
        advancedHtml.includes(`data-field="${field}"`),
      `高级配置模型缺少 ${field}`,
    );
  }
  assert.match(advancedHtml, /<details[^>]*data-role="model-item"/);
  assert.match(advancedHtml, /<summary/);
  assert.ok(selectTag(advancedHtml, "provider").length > 0);
  assert.ok(inputTag(advancedHtml, "upstreamModel").length > 0);

  const standardHtml = renderDetail(context("zh"), standard.id);
  assert.ok(selectTag(standardHtml, "provider").length > 0, "标准配置需要展示供应商");
  assert.equal(inputTag(standardHtml, "upstreamModel"), "", "标准配置没有上游模型字段");
  assert.equal(inputTag(standardHtml, "port"), "", "标准配置没有网关端口字段");
  assert.doesNotMatch(standardHtml, /data-field="gatewayToken"/);

  assert.match(advancedHtml, /data-action="remove-profile-model"/, "模型行尾需要删除按钮");
  assert.doesNotMatch(advancedHtml, /data-field="prefer1m"/, "1M 只保留支持开关");

  const readOnlyHtml = renderDetail(context("zh"), readOnly.id);
  assert.doesNotMatch(readOnlyHtml, /data-action="remove-profile-model"/, "只读镜像不可删除模型");
  assert.equal(selectTag(readOnlyHtml, "provider"), "", "只读镜像不展示供应商");
  assert.equal(inputTag(readOnlyHtml, "upstreamModel"), "");
  assert.match(readOnlyHtml, /只读/);
});

test("profiles v2 详情：readOnly 的所有控件 disabled，保存不可用", () => {
  const readOnly = profileByMode("readOnly");
  const html = renderDetail(context("zh"), readOnly.id);

  assert.equal(inputTag(html, "configName"), "", "详情不再有配置名称字段");
  assert.match(inputTag(html, "modelName"), /disabled/);
  assert.match(inputTag(html, "labelOverride"), /disabled/);
  assert.match(inputTag(html, "supports1m"), /disabled/);
  assert.match(selectTag(html, "anthropicFamilyTier"), /disabled/);
  assert.match(selectTag(html, "maxEffort"), /disabled/);
  assert.match(buttonTag(html, "add-model"), /disabled/);
  assert.equal(buttonTag(html, "add-field"), "", "只读档案没有透传区，也就没有添加项按钮");
  assert.match(buttonTag(html, "save-profile"), /disabled/);
});

test("profiles v2 详情：未知 id 返回可返回的空状态", () => {
  const html = renderDetail(context("zh"), "missing-profile");
  assert.match(html, /data-role="page-profile-detail"/);
  assert.match(html, /data-role="profile-not-found"/);
  assert.match(html, /data-action="profiles-back"/);
  assert.match(html, /href="#profiles"/);
  assert.doesNotMatch(html, /data-role="model-item"/);
});

test("profiles v2 路由接口：profileHref", () => {
  assert.equal(profileHref("abc"), "#profiles/abc");
  assert.equal(profileHref("a b"), "#profiles/a%20b");
});

/* ------------------------------------------------------------------ */
/* 宿主接线                                                            */
/* ------------------------------------------------------------------ */

test("profiles v2 宿主接线：open-profile、可切换搜索框与英文文案", () => {
  const html = render(context("zh"));
  assert.match(html, /data-action="open-profile"/);
  assert.match(html, /data-role="page-search" data-page-search data-open="false"/);
  assert.match(html, /data-role="profile-search"/);

  const en = render(context("en"));
  assert.match(en, /Profiles/);
  assert.match(en, /Add profile/);
  assert.doesNotMatch(en, /aria-label="Sort"/, "排序入口已移除");
  assert.match(en, /Local gateway/);

  const enDetail = renderDetail(context("en"), profileByMode("advanced").id);
  assert.match(enDetail, /Gateway token/);
  assert.match(enDetail, /Add field/);
  assert.match(enDetail, /Save changes/);
  assert.equal(typeof renderClaudeFieldEntry, "function");
});

/* ------------------------------------------------------------------ */
/* 样式                                                                */
/* ------------------------------------------------------------------ */

test("profiles.css：黑白主按钮、蓝色开关、细分隔线与粘性保存", () => {
  const css = read("ui/renderer/pages/profiles.css");

  assert.match(css, /\.profiles-page\s*\{/);
  assert.match(css, /--profile-primary-bg:\s*#0b0b0b/i);
  assert.match(css, /--profile-primary-fg:\s*#f{3,6}[0-9a-f]{0,3}/i);
  assert.match(css, /\[data-theme="dark"\][\s\S]*?--profile-primary-bg:\s*#f[0-9a-f]{5}/i);
  assert.match(css, /--profile-switch-on:\s*#2a78d6/i);
  assert.match(css, /\.profile-switch input:checked \+ \.profile-switch-track/);
  assert.match(css, /background:\s*var\(--profile-switch-on\)/);

  const primary = block(css, ".profile-button--primary {");
  assert.match(primary, /background:\s*var\(--profile-primary-bg\)/);
  assert.match(primary, /color:\s*var\(--profile-primary-fg\)/);
  assert.doesNotMatch(primary, /harbor-brand/);

  const row = elementTag(css, /\.profile-row \{[^}]*padding:[^}]*\}/);
  assert.ok(row.length > 0, "缺少 .profile-row 行样式");
  assert.match(row, /border-bottom:\s*0/);
  assert.doesNotMatch(row, /box-shadow/);
  assert.match(css, /\.profiles-page \.profile-field-row|\.profile-field-row\s*\{/);
  assert.match(css, /border-bottom:\s*0/);
  assert.match(css, /\.profile-savebar\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(css, /\.profile-claude-row--draft\s*\{[\s\S]*?gap:/);
  assert.match(css, /\.profile-claude-input\s*\{[\s\S]*?flex:\s*1 1 0/);
  assert.match(css, /\.profile-input:disabled|\.profile-switch input:disabled/);
  assert.match(css, /prefers-reduced-motion/);
});

test("profiles v2 布局：内容 gutter 与全宽分隔线分层，不使用负边距", () => {
  const html = render(context("zh"));
  assert.match(html, /<header class="profiles-band profiles-head-band">/);
  assert.match(html, /<section class="profiles-band profiles-active"/);
  assert.match(html, /<div class="profile-list-head">[\s\S]*?class="profiles-gutter profile-grid"/);

  const firstRow = profileRow(html, profileByMode("standard").id);
  assert.match(firstRow, /class="profile-row-open"/);

  const detail = renderDetail(context("zh"), profileByMode("advanced").id);
  assert.match(detail, /class="profiles-band profile-detail-heading"/);
  assert.match(detail, /class="profile-savebar profiles-band"[\s\S]*?class="profiles-gutter profile-savebar-inner"/);
  assert.match(detail, /class="profiles-gutter profile-model-summary-inner"/);
  assert.match(detail, /<div class="profile-field-row[^"]*">[\s\S]*?class="profiles-gutter profile-field-grid"/);

  const css = read("ui/renderer/pages/profiles.css");
  const page = block(css, ".profiles-page {");
  assert.match(page, /max-width:\s*none/);
  assert.match(page, /padding:\s*48px 0 24px/);

  const gutter = block(css, ".profiles-gutter {");
  assert.match(gutter, /max-width:\s*var\(--profile-gutter-max\)/);
  assert.match(gutter, /margin-inline:\s*auto/);
  assert.match(gutter, /padding-inline:\s*var\(--profile-gutter-pad\)/);

  const active = block(css, ".profiles-active {");
  assert.match(active, /border-top:\s*0/);
  assert.match(active, /border-bottom:\s*0/);
  const hero = block(css, ".profiles-hero {");
  assert.match(hero, /border-radius:\s*14px/);

  const row = block(css, ".profile-row {");
  assert.match(row, /border-bottom:\s*0/);
  assert.match(block(css, ".profile-list-head {"), /border-bottom:\s*0/);
  assert.match(block(css, ".profile-detail-heading {"), /border-bottom:\s*0/);
  assert.match(block(css, ".profile-section {"), /border-bottom:\s*0/);

  assert.doesNotMatch(css, /margin(?:-[a-z]+)?:\s*-[0-9]/);
  assert.doesNotMatch(css, /calc\([^)]*100vw/);
});

test("profiles v2 尺寸：标题、按钮、输入框与行高整体收紧", () => {
  const css = read("ui/renderer/pages/profiles.css");

  assert.match(block(css, ".profiles-heading h1 {"), /font-size:\s*32px/);
  assert.match(block(css, ".profile-button {"), /height:\s*32px/);
  assert.match(block(css, ".profiles-hero {"), /padding:\s*22px 24px 20px/);
  assert.match(block(css, ".profile-row {"), /padding:\s*0/);
  assert.match(block(css, ".profiles-rows .profile-grid {"), /padding:\s*12px 16px/);
  assert.match(block(css, ".profile-detail-heading h1 {"), /font-size:\s*32px/);
  assert.match(block(css, ".profile-section {"), /padding:\s*16px 0/);
  assert.match(block(css, ".profile-field-grid {"), /min-height:\s*38px/);
  assert.match(block(css, ".profile-input {"), /height:\s*30px/);
  assert.match(block(css, "\n.profile-switch {"), /width:\s*32px/);
  assert.match(block(css, ".profile-claude-row--draft {"), /gap:\s*8px/);
  assert.match(block(css, ".profile-claude-input {"), /max-width:\s*none/);
});
