import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../ui/renderer/${path}`, import.meta.url), "utf8");
const block = (css: string, selector: string) => {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `missing ${selector}`);
  const end = css.indexOf("}", start);
  return css.slice(start, end + 1);
};

test("overview suggestions rely on spacing rather than horizontal rules", () => {
  const css = read("pages/overview.css");
  assert.match(block(css, ".ov-suggestions {"), /border-top:\s*0/);
  assert.match(block(css, ".ov-hint {"), /border-bottom:\s*0/);
});

test("profile regions and fields remove redundant dividers", () => {
  const css = read("pages/profiles.css");
  assert.match(block(css, ".profiles-active {"), /border-top:\s*0/);
  assert.match(block(css, ".profiles-hero-gateway {"), /border:\s*1px solid/);
  assert.match(block(css, ".profile-detail-heading {"), /border-bottom:\s*0/);
  assert.match(block(css, ".profile-section {"), /border-bottom:\s*0/);
  assert.match(block(css, ".profile-field-row {"), /border-bottom:\s*0/);
  assert.match(block(css, ".profile-row {"), /border-bottom:\s*0/);
  assert.match(block(css, ".profile-list-head {"), /border-bottom:\s*0/);
  assert.match(block(css, ".profile-model {"), /border-bottom:\s*0/);
  assert.match(block(css, ".profile-model:first-child {"), /border-top:\s*0/);
});

test("provider and usage sections keep only meaningful list boundaries", () => {
  const providers = read("pages/providers.css");
  assert.match(block(providers, ".pv-toolbar {"), /border-bottom:\s*0/);
  assert.match(block(providers, ".pv-form {"), /border-top:\s*0/);
  assert.match(block(providers, ".pv-field {"), /border-bottom:\s*0/);
  assert.match(block(providers, ".pv-row {"), /border-bottom:\s*0/);
  assert.match(block(providers, ".pv-empty {"), /border-bottom:\s*0/);
  const usage = read("pages/usage.css");
  assert.match(block(usage, ".page--usage .usage-block + .usage-block {"), /border-top:\s*0/);
  assert.match(block(usage, ".page--usage .usage-quota-window + .usage-quota-window {"), /border-top:\s*0/);
  assert.match(block(usage, ".page--usage .usage-profile-select {"), /border-bottom:\s*0/);
  assert.match(block(usage, ".page--usage .usage-range-switch {"), /border:\s*0/);
});
