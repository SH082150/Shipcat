import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createTranslator } from "../ui/renderer/components/i18n.ts";
import { DEMO_PROVIDERS, render, renderDetail } from "../ui/renderer/pages/providers.ts";
import type { ProviderDetail, ProviderView } from "../ui/renderer/pages/providers.ts";
import type { PageContext } from "../ui/renderer/pages/types.ts";

const read = (relative: string): string =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const ICON_PLACEHOLDER = /<span class="[^"]*\bicon-placeholder\b[^"]*"[^>]*><\/span>/g;

function context(language: "zh" | "en"): PageContext {
  return {
    t: createTranslator(language),
    language,
    clientInfo: { username: "demo" },
  };
}

function checkedValue(html: string, value: string): boolean {
  return new RegExp(`value="${value}"[^>]*\\bchecked\\b|\\bchecked\\b[^>]*value="${value}"`).test(
    html,
  );
}

/** 保留的空占位必须保持空元素；真实图标使用 aria-hidden 的 SVG。 */
function assertIconsAreEmptySpans(html: string): void {
  const icons = html.match(ICON_PLACEHOLDER) ?? [];
  assert.equal(
    (html.match(/icon-placeholder/g) ?? []).length,
    icons.length,
    "图标占位元素内部不得绘制内容",
  );
  for (const tag of html.match(/<svg\b[^>]*>/g) ?? []) {
    assert.match(tag, /aria-hidden="true"/, "图标 SVG 不应被读屏重复朗读");
  }
}

test("列表页：标题、搜索、添加主按钮与供应商行", () => {
  const html = render(context("zh"));

  assert.match(html, /data-role="page-providers"/);
  assert.match(html, /<h1[^>]*>供应商<\/h1>/);
  assert.match(html, /data-role="provider-search"/);
  assert.match(html, /type="search"/);
  assert.match(html, /placeholder="搜索供应商"/);
  assert.match(html, /data-action="add-provider"/);
  assert.match(html, /class="[^"]*pv-button--primary/);
  assert.match(html, />添加供应商</);

  assert.equal(
    (html.match(/data-role="provider-row"/g) ?? []).length,
    DEMO_PROVIDERS.length,
    "默认应展示演示供应商",
  );
  for (const provider of DEMO_PROVIDERS) {
    assert.ok(html.includes(provider.name), `缺少演示供应商 ${provider.name}`);
    assert.ok(html.includes(provider.inferenceGatewayBaseUrl));
  }

  assert.doesNotMatch(html, /演示数据/, "演示数据徽标已移除");
  assert.doesNotMatch(html, /onclick=/i);
  assertIconsAreEmptySpans(html);
});

test("列表页：不泄露演示密钥，行按钮携带 data-provider-id", () => {
  const html = render(context("zh"));

  const rowButtons = html.match(/<button[^>]*class="[^"]*pv-row-button[^"]*"[^>]*>/g) ?? [];
  assert.equal(rowButtons.length, DEMO_PROVIDERS.length);
  for (const [index, button] of rowButtons.entries()) {
    assert.match(button, /data-provider-id="[^"]+"/);
    assert.ok(button.includes(`data-provider-id="${DEMO_PROVIDERS[index]?.id}"`));
  }

  assert.doesNotMatch(html, /sk-demo|inferenceGatewayApiKey/);
  assert.doesNotMatch(html, /<form/i);
});

test("列表页：英文文案与演示标注同样成立", () => {
  const html = render(context("en"));

  assert.match(html, /<h1[^>]*>Providers<\/h1>/);
  assert.match(html, /placeholder="Search providers"/);
  assert.match(html, />Add provider</);
  assert.doesNotMatch(html, /Demo data/, "演示数据徽标已移除");
  assertIconsAreEmptySpans(html);
});

test("添加供应商页：与详情同构、字段为空、保存为添加且无删除", () => {
  const html = renderDetail(context("zh"), "new");

  assert.match(html, /data-role="page-provider-add"/);
  assert.match(html, /<h1>添加供应商<\/h1>/);
  assert.match(html, /data-action="create-provider"/);
  assert.match(html, />添加<\/span>/);
  assert.doesNotMatch(html, /data-action="delete-provider"/, "新增页不显示删除");
  assert.doesNotMatch(html, /pv-danger/);

  // core Provider 的四个配置项：名称、Base URL、API Key、认证方式。
  assert.match(html, /name="name"/);
  assert.match(html, /name="inferenceGatewayBaseUrl"/);
  assert.match(html, /name="inferenceGatewayApiKey"/);
  assert.match(html, /name="inferenceGatewayAuthScheme"/);
  assert.match(html, /placeholder="例如 deepseek"/);
  assert.doesNotMatch(html, /name="name"[^>]*value="[^"]+"/, "新增页名称为空");
  assert.doesNotMatch(html, /inferenceGatewayApiKey"[^>]*value="[^"]+"/, "新增页密钥为空");
});

test("列表页：ProviderView 可注入，空列表有独立空状态", () => {
  const providers: ProviderView[] = [
    {
      id: "local",
      name: "Local gateway",
      inferenceGatewayBaseUrl: "http://127.0.0.1:3456",
      inferenceGatewayAuthScheme: "bearer",
    },
  ];

  const injected = render(context("en"), { providers });
  assert.equal((injected.match(/data-role="provider-row"/g) ?? []).length, 1);
  assert.match(injected, /data-provider-id="local"/);
  assert.match(injected, /http:\/\/127\.0\.0\.1:3456/);
  assert.doesNotMatch(injected, /Demo data/);
  assert.doesNotMatch(injected, /deepseek/i);

  const empty = render(context("en"), { providers: [] });
  assert.match(empty, /data-role="providers-empty"/);
  assert.match(empty, /data-action="add-provider"/);
  assert.equal((empty.match(/data-role="provider-row"/g) ?? []).length, 0);
  assert.doesNotMatch(empty, /Demo data/);
});

test("详情页：返回、四个 core 字段、粘性保存与右上删除", () => {
  const html = renderDetail(context("zh"), "deepseek");

  assert.match(html, /data-role="page-provider-detail"/);
  assert.match(html, /data-provider-id="deepseek"/);
  assert.match(html, /data-page="providers"/);
  assert.match(html, />供应商</);

  assert.match(html, /name="name"/);
  assert.match(html, /name="inferenceGatewayBaseUrl"/);
  assert.match(html, /name="inferenceGatewayApiKey"/);
  assert.match(html, /type="password"/);
  assert.match(html, /name="inferenceGatewayAuthScheme"/);
  assert.equal((html.match(/name="inferenceGatewayAuthScheme"/g) ?? []).length, 2);
  assert.match(html, /value="x-api-key"/);
  assert.match(html, /value="bearer"/);
  assert.equal(checkedValue(html, "x-api-key"), true);
  assert.equal(checkedValue(html, "bearer"), false);

  assert.match(html, /data-role="provider-savebar"/);
  assert.match(html, /data-action="save-provider"/);
  assert.match(html, />保存</);
  assert.match(html, /data-action="delete-provider"/);
  assert.match(html, /class="[^"]*pv-danger/);
  assert.match(html, />删除供应商</);

  assert.doesNotMatch(html, /onclick=/i);
  assert.doesNotMatch(html, /type="submit"/);
  assertIconsAreEmptySpans(html);
});

test("详情页：ProviderDetail 注入、转义与 bearer 选中", () => {
  const detail: ProviderDetail = {
    id: "custom",
    name: 'Custom <Gateway> "One"',
    inferenceGatewayBaseUrl: "http://127.0.0.1:3456",
    inferenceGatewayAuthScheme: "bearer",
    inferenceGatewayApiKey: '"><script>alert(1)</script>',
  };

  const html = renderDetail(context("en"), "custom", detail);

  assert.match(html, /Custom &lt;Gateway&gt; &quot;One&quot;/);
  assert.doesNotMatch(html, /<script>/i);
  assert.doesNotMatch(html, /<Gateway>/);
  assert.match(html, /value="http:\/\/127\.0\.0\.1:3456"/);
  assert.match(html, /&quot;&gt;&lt;script&gt;/);
  assert.equal(checkedValue(html, "bearer"), true);
  assert.equal(checkedValue(html, "x-api-key"), false);
  assert.match(html, />Delete provider</);
  assert.match(html, />Save</);
});

test("详情页：未知 id 显示缺失状态，不渲染表单与删除", () => {
  const html = renderDetail(context("zh"), "missing-provider");

  assert.match(html, /data-role="page-provider-detail"/);
  assert.match(html, /data-role="provider-detail-missing"/);
  assert.match(html, /data-page="providers"/);
  assert.doesNotMatch(html, /data-role="provider-form"/);
  assert.doesNotMatch(html, /data-action="delete-provider"/);
});

test("样式：黑/白主按钮、细分割线、红色删除、粘性保存、无橙色按钮", () => {
  const css = read("ui/renderer/pages/providers.css");

  assert.match(css, /\.pv-search\s*\{/);
  assert.match(css, /\.pv-row-button\s*\{/);
  assert.match(css, /\.pv-row\s*\{[^}]*border-bottom:\s*0/);

  assert.match(css, /\.pv-button--primary\s*\{[\s\S]*?background:\s*var\(--pv-strong-bg\)/);
  assert.match(css, /--pv-strong-bg:\s*#0b0b0b/i);
  assert.match(css, /\[data-theme="dark"\][\s\S]*?--pv-strong-bg:\s*#ffffff/i);

  assert.match(css, /\.pv-danger\s*\{[\s\S]*?background:\s*var\(--pv-danger-solid\)/);
  assert.match(css, /\.pv-danger\s*\{[\s\S]*?color:\s*#ffffff/);
  assert.match(css, /--pv-danger-solid:\s*#b42318/i);

  assert.match(css, /\.pv-savebar\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(css, /\.pv-savebar\s*\{[\s\S]*?bottom:\s*\d+px/);

  assert.doesNotMatch(css, /#d97757|#e08a6b|--harbor-brand/i, "供应商页不使用橙色");
  assert.match(css, /prefers-reduced-motion/);
});

test("范围：页面不读取 core，导出 renderDetail 与两个数据接口", () => {
  const source = read("ui/renderer/pages/providers.ts");
  assert.doesNotMatch(source, /from\s+["'][^"']*core\//);
  assert.match(source, /export interface ProviderView/);
  assert.match(source, /export interface ProviderDetail/);
  assert.match(source, /export function renderDetail/);
  assert.match(source, /export function render/);
});
