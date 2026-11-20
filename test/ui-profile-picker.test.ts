import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../ui/renderer/${path}`, import.meta.url), "utf8");

test("usage profile dialog is a single-column list without a sidebar", () => {
  const source = read("settings/profile-picker.ts");
  assert.match(source, /data-role", "picker-add"/);
  assert.match(source, /data-role", "picker-remove"/);
  assert.match(source, /data-action", "remove-profile"/);
  assert.match(source, /ch-picker-row/);
  assert.match(source, /添加配置文件/);
  assert.match(source, /onPickFile/, "添加配置文件应走系统文件选择框");
  assert.doesNotMatch(source, /新配置文件/, "不再自动插入空白配置文件");
  assert.doesNotMatch(source, /ch-picker-sidebar/, "不再使用左侧列表栏");
  assert.doesNotMatch(source, /ch-picker-field/, "不再有右侧详情表单");
});

test("usage profile dialog reuses settings dimensions and uses a red removal button", () => {
  const css = read("settings/settings.css");
  assert.match(css, /\.ch-picker\s*\{[\s\S]*?width:\s*min\(880px, 100%\)/);
  assert.match(css, /\.ch-picker\s*\{[\s\S]*?height:\s*min\(620px, 100%\)/);
  assert.match(css, /\.ch-picker\s*\{[\s\S]*?flex-direction:\s*column/);
  assert.match(css, /\.ch-picker-remove\s*\{[\s\S]*?background:\s*#b42318/);
  assert.match(css, /\.ch-picker-remove\s*\{[\s\S]*?color:\s*#fff/);
});
