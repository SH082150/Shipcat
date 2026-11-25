/**
 * Monitor 页结构测试：只锁可观察骨架（标题、汇总卡、11 列表头、弹窗、空态）。
 * 行为在 ui-state/style 之外由主进程与手动验证覆盖。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createTranslator } from "../ui/renderer/components/i18n.ts";
import { renderMonitorPage } from "../ui/renderer/pages/monitor.ts";

const context = (language: "zh" | "en") => ({
  t: createTranslator(language),
  language,
  clientInfo: { platform: "darwin", hostname: "test", username: "t" },
});

test("Monitor 页：标题、三张汇总卡与 11 列表头", () => {
  const html = renderMonitorPage(context("zh"));
  assert.match(html, /page--monitor/);
  assert.match(html, /<h1>事件监测<\/h1>/);
  assert.match(html, /实时事件/);
  assert.equal((html.match(/class="monitor-card"/g) ?? []).length, 3);
  const headers = html.match(/<div class="monitor-head">([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.equal((headers.match(/<span[\s>]/g) ?? []).length, 11);
  for (const label of ["时间", "类型", "模块", "供应商", "模型", "新增输入", "缓存读取", "输出", "工具调用", "本轮命中率", "状态"]) {
    assert.ok(headers.includes(label), `缺少表头 ${label}`);
  }
});

test("Monitor 页：分栏、搜索、分页、弹窗与空态占位都在", () => {
  const html = renderMonitorPage(context("en"));
  for (const value of ["all", "chat", "cowork", "code"]) {
    assert.ok(html.includes(`data-monitor-tab="${value}"`), `缺少分栏 ${value}`);
  }
  assert.match(html, /data-monitor-search/);
  assert.match(html, /data-monitor-query/);
  assert.match(html, /data-monitor-action="prev"/);
  assert.match(html, /data-monitor-action="next"/);
  assert.match(html, /data-monitor-dialog/);
  assert.match(html, /data-monitor-empty/);
  assert.match(html, /No records yet/);
});

test("Monitor 页：官方字段不拼进未转义文本", () => {
  const html = renderMonitorPage(context("zh"));
  assert.equal(html.includes("<script"), false);
  assert.equal(html.includes("innerHTML"), false);
});
