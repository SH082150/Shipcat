import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { render as renderProfiles } from "../ui/renderer/pages/profiles.ts";
import { render as renderOverview } from "../ui/renderer/pages/overview.ts";
import { render as renderUsage } from "../ui/renderer/pages/usage.ts";
import { createTranslator } from "../ui/renderer/components/i18n.ts";

const context = { language: "zh" as const, t: createTranslator("zh"), clientInfo: {} };
const read = (path: string) => readFileSync(new URL(`../ui/renderer/${path}`, import.meta.url), "utf8");

test("profile rows use quiet type text and an explicit applied check", () => {
  const html = renderProfiles(context);
  assert.match(html, /class="profile-status profile-status--active"[^>]*aria-label="已激活"[^>]*>✓<\/span>/);
  assert.match(html, /data-action="apply-profile"[^>]*data-profile-id="prf-standard"/);
  const css = read("pages/profiles.css");
  assert.match(css, /\.profile-type-tag\s*\{[\s\S]*?border:\s*0/);
  assert.match(css, /\.profile-type-tag\s*\{[\s\S]*?background:\s*transparent/);
  assert.match(css, /\.profile-status--active\s*\{[\s\S]*?color:\s*var\(--harbor-text\)/);
});

test("active profile is a name-led summary card above the list", () => {
  const html = renderProfiles(context);
  assert.match(html, /profiles-hero-gateway[\s\S]*?data-role="gateway-bar"/);
  assert.match(html, /profiles-hero-head[\s\S]*?profiles-hero-name[\s\S]*?profiles-hero-tag/);
  assert.match(html, /profiles-hero-model[\s\S]*?profiles-hero-model-route/);
  const css = read("pages/profiles.css");
  assert.match(css, /\.profiles-hero\s*\{[\s\S]*?border-radius:\s*14px/);
  assert.match(css, /\.profiles-hero-model:hover\s*\{[\s\S]*?background:\s*var\(--harbor-hover\)/);
  assert.match(css, /\.profiles-hero-gateway\s*\{[\s\S]*?border-radius:\s*10px/);
});

test("page titles share the reference's restrained serif treatment", () => {
  for (const path of ["pages/providers.css", "pages/profiles.css", "pages/usage.css", "styles.css"]) {
    assert.match(read(path), /harbor-font-display/);
  }
});

test("overview welcome is vertically centered by auto margins", () => {
  const css = read("pages/overview.css");
  assert.match(css, /\.ov-welcome\s*\{[\s\S]*?margin-top:\s*auto/);
  assert.match(css, /\.ov-suggestions\s*\{[\s\S]*?margin-bottom:\s*auto/);
});

test("overview shows at most two suggestions and keeps them under the profile card", () => {
  const hints = ["one", "two", "three"].map(id => ({
    id, title: id, description: id,
    target: { action: "navigate" as const, page: "usage" as const },
  }));
  const html = renderOverview({ ...context, overview: { hints } });
  assert.equal((html.match(/class="ov-hint"/g) ?? []).length, 2);
  assert.equal(html.includes('data-hint="three"'), false);
  const overview = read("pages/overview.ts");
  assert.match(overview, /resolveHints\(content, copy\)\.slice\(0, 2\)|const hints = resolveHints\(content, copy\)\.slice\(0, 2\)/);
  const css = read("pages/overview.css");
  assert.match(css, /\.page--overview\s*\{[\s\S]*?min-height:\s*100%/);
  assert.match(css, /\.page--overview\s*\{[\s\S]*?display:\s*flex/);
  assert.match(css, /\.ov-suggestions\s*\{[\s\S]*?margin-bottom:\s*auto/);
});

test("usage leads with history and uses the brand accent blue", () => {
  const html = renderUsage(context);
  assert.ok(html.indexOf('data-role="usage-history"') < html.indexOf('data-role="usage-daily"'));
  assert.doesNotMatch(html, /data-role="usage-quota"/);
  const css = read("pages/usage.css");
  assert.match(css, /--usage-blue:\s*#2a78d6/i);
  assert.match(css, /--usage-level-4:\s*color-mix\(in srgb, var\(--usage-blue\)/);
});

test("usage removes repeated prototype explanations while retaining data provenance", () => {
  const html = renderUsage(context);
  assert.equal(html.includes('class="page-note"'), false);
  assert.equal(html.includes('class="usage-cells-note"'), false);
  assert.match(html, /usage-ledger/);
  assert.match(html, /usage-demo-note/);
  assert.match(html, /Claude/);
});
