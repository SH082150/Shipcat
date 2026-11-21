import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createTranslator } from "../ui/renderer/components/i18n.ts";
import type { PageContext } from "../ui/renderer/pages/types.ts";
import {
  USAGE_RANGES,
  USAGE_RANGE_META,
  buildUsageViewData,
  createDemoCells,
  createDemoDaily,
  render,
  renderHeatmap,
  renderRangeCaption,
} from "../ui/renderer/pages/usage.ts";
import type {
  HeatmapCell,
  UsageRange,
  UsageViewData,
} from "../ui/renderer/pages/usage.ts";

const read = (relative: string): string =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const context = (language: "zh" | "en" = "zh"): PageContext => ({
  t: createTranslator(language),
  language,
  clientInfo: { username: "alice" },
});

const count = (html: string, needle: RegExp): number => (html.match(needle) ?? []).length;

test("UsageRange：三档、336 格、24×14，文案天数严格对应", () => {
  assert.deepEqual([...USAGE_RANGES], ["30min", "1h", "1d"]);

  assert.equal(USAGE_RANGE_META["30min"].cells, 336);
  assert.equal(USAGE_RANGE_META["30min"].columns, 24);
  assert.equal(USAGE_RANGE_META["30min"].rows, 14);
  assert.equal(USAGE_RANGE_META["30min"].days, 7);
  assert.equal(USAGE_RANGE_META["30min"].bucketMinutes, 30);

  assert.equal(USAGE_RANGE_META["1h"].cells, 336);
  assert.equal(USAGE_RANGE_META["1h"].days, 14, "1h 文案必须是 14 天 = 24 × 14 小时");
  assert.equal(USAGE_RANGE_META["1h"].bucketMinutes, 60);

  assert.equal(USAGE_RANGE_META["1d"].cells, 336);
  assert.equal(USAGE_RANGE_META["1d"].days, 336);
  assert.equal(USAGE_RANGE_META["1d"].bucketMinutes, 1440);

  for (const range of USAGE_RANGES) {
    assert.equal(
      USAGE_RANGE_META[range].cells,
      USAGE_RANGE_META[range].columns * USAGE_RANGE_META[range].rows,
    );
  }

  assert.match(renderRangeCaption("30min", "zh"), /最近 7 天/);
  assert.match(renderRangeCaption("30min", "zh"), /30 分钟/);
  assert.match(renderRangeCaption("1h", "zh"), /最近 14 天/);
  assert.match(renderRangeCaption("1h", "zh"), /1 小时/);
  assert.match(renderRangeCaption("1d", "zh"), /最近 336 天/);
  assert.match(renderRangeCaption("1d", "zh"), /1 天/);
  assert.match(renderRangeCaption("1h", "en"), /Last 14 days/);
  assert.match(renderRangeCaption("1d", "en"), /Last 336 days/);
});

test("renderHeatmap：任何区间都输出 336 格，空数据一律低对比灰", () => {
  for (const range of USAGE_RANGES) {
    const html = renderHeatmap(range);
    assert.equal(count(html, /data-usage-cell="/g), 336, `${range} 必须 336 格`);
    assert.match(html, /data-columns="24"/);
    assert.match(html, /data-rows="14"/);
    assert.match(html, new RegExp(`data-usage-range="${range}"`));
    assert.match(html, /role="img"/);
    assert.match(html, /aria-label="[^"]*336[^"]*"/);
    assert.equal(count(html, /data-level="0"/g), 336);
    assert.equal(count(html, /usage-cell--empty/g), 336);
    assert.equal(count(html, /data-level="[1-4]"/g), 0);
      assert.doesNotMatch(html, /style="/i);
  }
});

test("renderHeatmap：外部 cells 截断/补齐到 336，转义标签，强度夹在 0–4", () => {
  const cells: HeatmapCell[] = [
    { at: "2026-01-01T00:00:00.000Z", value: 3, level: 2, label: "<b>3</b>" },
    { at: "2026-01-01T00:30:00.000Z", value: 9, level: 9 },
    { at: "2026-01-01T01:00:00.000Z", value: null, level: -1 },
  ];
  const html = renderHeatmap("30min", cells);

  assert.equal(count(html, /data-usage-cell="/g), 336);
  assert.equal(count(html, /data-level="4"/g), 1, "越界强度夹到 4");
  assert.equal(count(html, /data-level="0"/g), 334, "负数与空格都归为 0");
  assert.match(html, /&lt;b&gt;3&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>/);

  const overflow = Array.from({ length: 400 }, (_, index) => ({
    at: `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
    value: index,
    level: 1,
  })) satisfies HeatmapCell[];
  assert.equal(count(renderHeatmap("1d", overflow), /data-usage-cell="/g), 336);
});

test("createDemoCells：确定性演示强度，不是随机数，也不是真实统计", () => {
  for (const range of USAGE_RANGES) {
    const first = createDemoCells(range);
    const second = createDemoCells(range);
    assert.equal(first.length, 336);
    assert.deepEqual(first, second, `${range} 的演示数据必须完全确定`);
    assert.ok(first.every((cell) => cell.level >= 0 && cell.level <= 4));
    assert.ok(first.some((cell) => cell.level === 0), "应有低对比空格");
    assert.ok(first.some((cell) => cell.level > 0), "应展示强度层级");
    assert.ok(first.every((cell) => Number.isNaN(Date.parse(cell.at)) === false));
  }

  const demo = renderHeatmap("1h", createDemoCells("1h"));
  assert.equal(demo, renderHeatmap("1h", createDemoCells("1h")));
  assert.ok(count(demo, /data-level="[1-4]"/g) > 0);
});

test("用量页结构：历史用量热力图 + 总使用量卡 + 按天用量，绝不伪造数值", () => {
  const html = render(context("zh"));

  assert.match(html, /data-role="page-usage"/);
  assert.match(html, /<h1[^>]*>用量<\/h1>/);
  assert.doesNotMatch(html, /data-role="usage-quota"/, "额度区已移除");

  // 历史用量：说明数据来自本机记录，不限于网关。
  assert.match(html, /data-role="usage-history"/);
  assert.match(html, /usage-sync/);
  assert.match(html, /包含所有使用场景，不限于网关/);
  assert.doesNotMatch(html, /只统计经由本地网关/);
  assert.doesNotMatch(html, /gateway traffic/i);

  // 分段切换：三个按钮，默认 1h，只带 data-usage-range。
  assert.equal(count(html, /data-usage-range="/g), 4, "3 个按钮 + 热力图自身");
  for (const range of USAGE_RANGES) {
    assert.match(html, new RegExp(`<button[^>]*data-usage-range="${range}"`));
  }
  assert.equal(count(html, /data-usage-range="1h"[^>]*aria-pressed="true"/g), 1);
  assert.equal(count(html, /data-chart-range="30"[^>]*aria-pressed="true"/g), 1);
  assert.equal(count(html, /data-chart-mode="chart"[^>]*aria-pressed="true"/g), 1);

  // 热力图与文案。
  assert.equal(count(html, /data-usage-cell="/g), 336);
  assert.match(html, /data-role="usage-heatmap-host"/);
  assert.match(html, /data-role="usage-range-caption"[^>]*>[^<]*最近 14 天/);
  assert.match(html, /示例强度，非真实统计/);
  assert.match(html, />少</);
  assert.match(html, />多</);
  assert.match(html, /data-role="usage-overall"/);
  assert.match(html, /总使用量/);
  assert.match(html, /实际消耗 Token/);
  assert.match(html, /data-role="usage-daily-card"/);
  assert.match(html, /每日 Token/);
  assert.equal(count(html, /data-chart-range="/g), 3);

  assert.doesNotMatch(html, /style="/i);
  assert.doesNotMatch(html, /onclick=/i);
  assert.doesNotMatch(html, /\$\s?\d/);
  assert.doesNotMatch(
    html.replace(/<dd>\d+(?:\.\d+)?%<\/dd>/g, ""),
    /\d+%/,
    "只有缓存命中率可以展示百分比",
  );
});

test("用量页英文：14 days、数据来源说明与按钮文案", () => {
  const html = render(context("en"));
  assert.match(html, /<h1[^>]*>Usage<\/h1>/);
  assert.match(html, /Last 14 days/);
  assert.match(html, /24 × 14 hours|24 \* 14 hours|14 days/);
  assert.match(html, /usage-sync/);
  assert.match(html, /not only the gateway/i);
  assert.match(html, /Sample intensity — not real usage/);
  assert.match(html, /data-usage-range="30min"/);
});

test("UsageViewData：默认无同步记录，按天示例数据可用", () => {
  const data = buildUsageViewData("zh");

  assert.equal(data.ledger.lastSyncedAt, null);
  assert.equal(data.demo, true);
  assert.equal(data.daily?.length, 90);

  const custom: UsageViewData = {
    ledger: { lastSyncedAt: "2026-01-01T00:00:00.000Z", recordCount: 10 },
    daily: createDemoDaily(30),
    demo: false,
  };
  const html = render(context("zh"), custom);
  assert.match(html, /data-role="usage-overall"/);
  assert.match(html, /data-role="usage-daily-card"/);
  assert.doesNotMatch(html, /示例强度/);
  assert.equal(count(html, /data-usage-cell="/g), 336);
  assert.equal(count(html, /data-level="[1-4]"/g), 0, "无热力图数据时不得伪造强度");
});

test("usage.css：24×14 网格、空灰、蓝色开关、黑白主按钮、细分割线", () => {
  const css = read("ui/renderer/pages/usage.css");

  assert.match(css, /\.page--usage/);
  assert.match(css, /grid-template-columns:\s*repeat\(24/);
  assert.match(css, /grid-template-rows:\s*repeat\(14/);
  assert.match(css, /\.usage-cell--empty/);
  assert.match(css, /\.usage-range-button\[aria-pressed="true"\]/);
  assert.match(css, /--usage-blue/);
  assert.match(css, /\[data-theme="dark"\]/);
  assert.match(css, /border-top:\s*0/);
  assert.match(css, /\.usage-heat-row\s*\{[\s\S]*?align-items:\s*stretch/);
  assert.match(css, /\.usage-overall\s*\{[\s\S]*?height:\s*100%/);
  assert.match(css, /\.usage-overall\s*\{[\s\S]*?min-height:\s*0[\s\S]*?padding:\s*13px 18px/);
  assert.match(css, /\.usage-overall-total\s*\{[\s\S]*?font-size:\s*28px/);
  assert.match(css, /\.usage-overall-rows\s*\{[\s\S]*?margin:\s*8px 0 0/);
  assert.match(css, /\.usage-overall-row\s*\{[\s\S]*?padding:\s*4px 0/);
  assert.match(css, /\.usage-overall-searches\s*\{[\s\S]*?padding-top:\s*6px/);
  assert.match(css, /\.usage-chart-svg/);
  assert.match(css, /\.usage-data-table/);
  assert.match(css, /\.usage-table-wrap\s*\{[\s\S]*?overflow-y:\s*auto/);
});

test("usage.ts：注入页面样式并原地切换热力图，不重绘页头", () => {
  const source = read("ui/renderer/pages/usage.ts");

  assert.match(source, /pages\/usage\.css/);
  assert.match(source, /addEventListener\("click"/);
  assert.match(source, /data-usage-range/);
  assert.match(source, /data-role="usage-heatmap-host"/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /renderRangeCaption/);
  assert.doesNotMatch(source, /window\.location|navigate\(/);
});

test("用量页总使用量卡：真实消耗合计、五行明细（含缓存命中率）与无缓存写行", () => {
  const cells: HeatmapCell[] = [
    {
      at: "2026-11-18T04:00:00.000Z",
      value: 1000,
      level: 2,
      detail: {
        inputTokens: 600,
        outputTokens: 200,
        cacheReadTokens: 150,
        cacheWriteTokens: 50,
        webSearchRequests: 0,
        calls: 3,
        errors: 1,
        costUsd: 1.25,
        models: { "model-a": 1000 },
        surfaces: { chat: 3 },
      },
    },
    {
      at: "2026-11-18T05:00:00.000Z",
      value: 500,
      level: 1,
      detail: {
        inputTokens: 300,
        outputTokens: 100,
        cacheReadTokens: 80,
        cacheWriteTokens: 20,
        webSearchRequests: 1,
        calls: 2,
        errors: 0,
        costUsd: 0,
        models: { "model-b": 500 },
        surfaces: { code: 2 },
      },
    },
  ];
  const data: UsageViewData = {
    ledger: { lastSyncedAt: null, recordCount: null },
    heatmap: { "1h": cells },
    daily: createDemoDaily(30),
    demo: false,
  };

  const html = render(context("zh"), data);
  assert.match(html, /data-role="usage-overall"/);
  assert.match(html, /总使用量/);
  assert.match(html, /实际消耗 Token/);
  assert.match(html, /最近 14 天/);
  assert.match(html, /usage-overall-total">1\.5K</, "真实消耗 = 输入 + 输出 + 缓存读 + 缓存写");
  assert.match(html, /输入（未缓存）/);
  assert.match(html, /缓存命中率/);
  assert.match(html, /缓存命中率[\s\S]*?<dd>20\.35%<\/dd>/, "230 / (230 + 900) = 20.35%");
  assert.match(html, /缓存读 ÷（缓存读 \+ 输入未缓存）/);
  assert.match(html, /调用次数/);
  assert.match(html, />900</);
  assert.match(html, />300</);
  assert.match(html, />230</);
  assert.match(html, /1 次网页搜索/);
  assert.doesNotMatch(html, /缓存写<\/dt>/, "缓存写不单独占一行");
  assert.doesNotMatch(html, /\$1\.25/, "卡片不再展示费用");
  assert.doesNotMatch(html, /model-a/);
  assert.equal(count(html, /data-usage-cell="/g), 336);

  assert.match(html, /data-role="usage-daily-card"/);
  assert.match(html, /每日 Token/);
  assert.equal(count(html, /data-chart-range="/g), 3);
  assert.match(html, /data-chart-range="30"[^>]*aria-pressed="true"/);
  assert.match(html, /data-chart-mode="chart"[^>]*aria-pressed="true"/);
  assert.match(html, /data-chart-mode="table"/);
  assert.match(html, /usage-chart-svg/);
  assert.match(html, /usage-bar--chat/);
  assert.match(html, /usage-bar--cowork/);
  assert.match(html, /usage-bar--code/);
  assert.match(html, /usage-chart-tip/);

  const english = render(context("en"), data);
  assert.match(english, /Total usage/);
  assert.match(english, /Cache hit rate[\s\S]*?<dd>20\.35%<\/dd>/);
  assert.match(english, /real consumption tokens/);
  assert.match(english, /Last 14 days/);
  assert.match(english, /1 web search/);
});

test("用量页总使用量卡：无数据时按同一格式显示 0；按天卡片支持图表/表格与滚动", () => {
  const empty: UsageViewData = {
    ledger: { lastSyncedAt: null, recordCount: null },
    demo: false,
  };
  const html = render(context("zh"), empty);
  assert.doesNotMatch(html, /无记录/, "没有数据也保持同一套卡片格式");
  assert.match(html, /usage-overall-total">0</);
  assert.match(html, /缓存命中率[\s\S]*?<dd>—<\/dd>/, "分母为 0 时显示破折号");
  assert.match(html, /0 次网页搜索/);
  assert.doesNotMatch(html, /\$0\.00/);

  const source = read("ui/renderer/pages/usage.ts");
  assert.match(source, /addEventListener\("pointermove"/);
  assert.match(source, /addEventListener\("mousemove"/);
  assert.match(source, /function showCellOverall/);
  assert.match(source, /function formatCellScope/);
  assert.match(source, /data-chart-range/);
  assert.match(source, /data-chart-mode/);
  assert.match(source, /function updateDailyCard/);
  assert.match(source, /usage-chart-tip/);
  assert.match(source, /usage-table-wrap/);

  const css = read("ui/renderer/pages/usage.css");
  assert.match(css, /\.usage-heat-row\s*\{[\s\S]*?align-items:\s*stretch/);
  assert.match(css, /\.usage-overall\s*\{[\s\S]*?height:\s*100%/);
  assert.match(css, /\.usage-chart-svg/);
  assert.match(css, /\.usage-table-wrap\s*\{[\s\S]*?overflow-y:\s*auto/);
});
