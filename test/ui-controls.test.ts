import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { render as renderProfiles } from "../ui/renderer/pages/profiles.ts";
import { render as renderProviders } from "../ui/renderer/pages/providers.ts";
import { createTranslator } from "../ui/renderer/components/i18n.ts";

const context = { language: "zh" as const, t: createTranslator("zh"), clientInfo: {} };
const read = (path: string) => readFileSync(new URL(`../ui/renderer/${path}`, import.meta.url), "utf8");

test("profile search expands inside the toolbar and receives the shared action", () => {
  const html = renderProfiles(context);
  const actions = html.match(/<div class="profiles-actions">[\s\S]*?<\/header>/)?.[0] ?? "";
  assert.match(actions, /data-role="page-search" data-page-search data-open="false"/);
  assert.match(actions, /data-action="search-profiles"/);
  assert.match(actions, /<input type="search"/);
  assert.match(actions, /data-action="search-toggle"[^>]*aria-label="关闭搜索"|aria-label="关闭搜索"[^>]*data-action="search-toggle"/);
  const css = read("pages/profiles.css");
  assert.match(css, /\.profile-search\s*\{[\s\S]*?width:\s*32px/);
  assert.match(css, /\.profile-search\[data-open="true"\]\s*\{[\s\S]*?width:\s*248px/);
});

test("profile rows are inset rounded buttons rather than window-wide strips", () => {
  const html = renderProfiles(context);
  assert.match(html, /class="profiles-rows profiles-gutter"/);
  assert.match(html, /<div class="profile-row profile-grid"[^>]*>[\s\S]*?<a class="profile-row-open"/);
  assert.doesNotMatch(html, /<span class="profiles-gutter profile-grid">/);
  const css = read("pages/profiles.css");
  assert.match(css, /\.profile-row\s*\{[\s\S]*?display:\s*grid/);
  assert.match(css, /\.profile-row\s*\{[\s\S]*?border-radius:\s*8px/);
  assert.match(css, /\.profile-row:hover\s*\{[\s\S]*?background:\s*var\(--harbor-hover\)/);
});

test("profile status column exposes apply actions and only the applied row gets a check", () => {
  const html = renderProfiles(context);
  assert.equal((html.match(/data-action="apply-profile"/g) ?? []).length, 2);
  assert.match(html, /data-action="apply-profile"[^>]*data-profile-id="prf-standard"/);
  assert.doesNotMatch(html, /data-action="apply-profile"[^>]*data-profile-id="prf-shared"/);
  assert.match(html, /data-status="readonly"[^>]*aria-label="只读"[^>]*><\/span>/);
  assert.doesNotMatch(html, />未激活<|>只读<|>—</);
  const css = read("pages/profiles.css");
  assert.match(css, /\.profile-apply\s*\{[\s\S]*?background:\s*var\(--profile-primary-bg\)/);
});

test("provider search sits left of add and expands leftwards on demand", () => {
  const html = renderProviders(context);
  assert.match(html, /data-action="search-providers"/);
  assert.match(html, /class="pv-search" data-role="page-search" data-page-search data-open="false"/);

  const searchAt = html.indexOf('data-action="search-providers"');
  const addAt = html.indexOf('data-action="add-provider"');
  assert.ok(searchAt >= 0 && addAt > searchAt, "搜索应位于添加供应商左侧");

  const css = read("pages/providers.css");
  assert.match(css, /\.pv-search\s*\{[\s\S]*?width:\s*32px/);
  assert.match(css, /\.pv-search-field\s*\{[\s\S]*?right:\s*0/);
  assert.match(css, /\.pv-search\[data-open="true"\] \.pv-search-field\s*\{[\s\S]*?width:\s*280px/);
});

test("settings exposes About in the sidebar and keeps client-info as an alias", () => {
  const settings = read("settings/settings.ts");
  assert.match(settings, /SETTINGS_SECTIONS = \["general", "privacy", "system", "about"\]/);
  assert.match(settings, /about:\s*"关于"/);
  assert.match(settings, /\["about", clientPane\]/);
  assert.match(settings, /initialSection === "client-info"\s*\?\s*"about"/);
});

test("profile typography and vertical rhythm match the reference page", () => {
  const css = read("pages/profiles.css");
  assert.match(css, /\.profiles-heading h1\s*\{[\s\S]*?font-size:\s*32px/);
  assert.match(css, /\.profiles-subtitle\s*\{[\s\S]*?font-size:\s*13px/);
  assert.match(css, /\.profiles-hero\s*\{[\s\S]*?border-radius:\s*14px/);
  assert.match(css, /\.profiles-hero-name\s*\{[\s\S]*?font-size:\s*24px/);
  assert.match(css, /\.profile-row-name\s*\{[\s\S]*?font-size:\s*13\.5px/);
  assert.match(css, /\.profile-list-head\s*\{[\s\S]*?font-size:\s*12px/);
});


