import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../ui/renderer/${path}`, import.meta.url), "utf8");

test("overview follows the centered official welcome composition", () => {
  const css = read("pages/overview.css");
  assert.match(css, /\.ov-welcome\s*\{[\s\S]*?justify-content:\s*center/);
  assert.match(css, /\.ov-greeting\s*\{[\s\S]*?clamp\(32px, 3vw, 40px\)/);
  assert.match(css, /\.ov-profile-main\s*\{[\s\S]*?padding:\s*20px 22px 12px/);
});

test("each overview suggestion is one full-row button", async () => {
  const { render } = await import("../ui/renderer/pages/overview.ts");
  const { createTranslator } = await import("../ui/renderer/components/i18n.ts");
  const html = render({ language: "zh", t: createTranslator("zh"), clientInfo: {} });
  const row = html.match(/<li class="ov-hint"[\s\S]*?<\/li>/)?.[0] ?? "";
  assert.match(row, /<li class="ov-hint"[^>]*>\s*<button type="button" class="ov-hint-button"/);
  assert.equal((row.match(/<button/g) ?? []).length, 1);
  assert.match(row, /ov-hint-icon[\s\S]*ov-hint-copy[\s\S]*<\/button>/);
});

test("provider controls and rows use the compact shared density", () => {
  const css = read("pages/providers.css");
  assert.match(css, /\.pv-head h1,[\s\S]*?font-size:\s*24px/);
  assert.match(css, /\.pv-button\s*\{[\s\S]*?height:\s*32px/);
  assert.match(css, /\.pv-row-button\s*\{[\s\S]*?padding:\s*12px 14px/);
  assert.match(css, /\.pv-field\s*\{[\s\S]*?padding:\s*12px 0/);
  assert.match(css, /\.pv-input\s*\{[\s\S]*?height:\s*30px/);
});

test("usage heatmap and its legend use a blue intensity scale", () => {
  const css = read("pages/usage.css");
  for (const level of [1, 2, 3, 4]) {
    assert.match(css, new RegExp(`--usage-level-${level}:\\s*color-mix\\(in srgb, var\\(--usage-blue\\)`));
  }
  assert.match(css, /\.usage-heatmap\s*\{[\s\S]*?width:\s*min\(100%, 480px\)/);
  assert.match(css, /\.usage-cell:hover\s*\{[\s\S]*?outline:\s*1px solid var\(--usage-blue\)/);
});

test("page gutters create breathing room without oversized content", () => {
  const shell = read("styles.css");
  assert.match(shell, /\.page\s*\{[\s\S]*?max-width:\s*880px/);
  assert.match(shell, /\.page\s*\{[\s\S]*?padding:\s*52px clamp\(28px, 5vw, 64px\) 48px/);
  const profiles = read("pages/profiles.css");
  assert.match(profiles, /\.profiles-hero\s*\{[\s\S]*?padding:\s*22px 24px 20px/);
});
