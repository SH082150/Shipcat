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

test("用量页结构：额度区占位 + 历史用量热力图，绝不伪造数值", () => {
  const html = render(context("zh"));

  assert.match(html, /data-role="page-usage"/);
  assert.match(html, /<h1[^>]*>用量<\/h1>/);

  // 额度区：配置文件选择器、余额/剩余额度占位、进度条位置。
  assert.match(html, /data-role="usage-quota"/);
  assert.match(html, /data-usage-profile/);
  assert.match(html, /<option[^>]*value="usage-claude"/);
  assert.match(html, /账户余额/);
  assert.match(html, /剩余额度/);
  assert.equal(count(html, /role="progressbar"/g), 3, "三个额度窗口各留一个进度条位置");
  assert.equal(count(html, /aria-valuetext="[^"]*"/g), 3);
  assert.doesNotMatch(html, /aria-valuenow=/, "未知额度不得伪造进度值");
  assert.match(html, /—/);

  // 历史用量：账本措辞，明确不是网关流量统计。
  assert.match(html, /data-role="usage-history"/);
  assert.match(html, /usage-ledger/);
  assert.match(html, /不是网关流量统计/);
  assert.doesNotMatch(html, /只统计经由本地网关/);
  assert.doesNotMatch(html, /gateway traffic/i);

  // 分段切换：三个按钮，默认 1h，只带 data-usage-range。
  assert.equal(count(html, /data-usage-range="/g), 4, "3 个按钮 + 热力图自身");
  for (const range of USAGE_RANGES) {
    assert.match(html, new RegExp(`<button[^>]*data-usage-range="${range}"`));
  }
  assert.equal(count(html, /aria-pressed="true"/g), 1);
  assert.match(html, /data-usage-range="1h"[^>]*aria-pressed="true"/);

  // 热力图与文案。
  assert.equal(count(html, /data-usage-cell="/g), 336);
  assert.match(html, /data-role="usage-heatmap-host"/);
  assert.match(html, /data-role="usage-range-caption"[^>]*>[^<]*最近 14 天/);
  assert.match(html, /示例强度，非真实统计/);
  assert.match(html, />Less</);
  assert.match(html, />More</);

  assert.doesNotMatch(html, /style="/i);
  assert.doesNotMatch(html, /onclick=/i);
  assert.doesNotMatch(html, /\$\s?\d/);
  assert.doesNotMatch(html, /\d+%/);
});

test("用量页英文：14 days、ledger 说明与按钮文案", () => {
  const html = render(context("en"));
  assert.match(html, /<h1[^>]*>Usage<\/h1>/);
  assert.match(html, /Last 14 days/);
  assert.match(html, /24 × 14 hours|24 \* 14 hours|14 days/);
  assert.match(html, /usage-ledger/);
  assert.match(html, /not gateway traffic/i);
  assert.match(html, /Sample intensity — not real usage/);
  assert.match(html, /data-usage-range="30min"/);
});

test("UsageViewData：清晰的未来接口，默认余额与进度全部为 null", () => {
  const data = buildUsageViewData("zh");

  assert.equal(data.selectedProfileId, "usage-claude");
  assert.equal(data.profiles[0]?.id, "usage-claude");
  assert.equal(data.quota.status, "unlinked");
  assert.equal(data.quota.balanceUsd, null);
  assert.equal(data.quota.remainingUsd, null);
  assert.equal(data.quota.windows.length, 3);
  assert.ok(data.quota.windows.every((window) => window.usedPercent === null));
  assert.ok(data.quota.windows.every((window) => window.resetAt === null));
  assert.equal(data.ledger.lastSyncedAt, null);
  assert.equal(data.demo, true);

  const custom: UsageViewData = {
    profiles: [{ id: "acme", label: "Acme <Corp>" }],
    selectedProfileId: "acme",
    quota: {
      status: "ready",
      balanceUsd: 12.5,
      remainingUsd: 8,
      windows: [
        { id: "five_hour", label: "5h", usedPercent: 42, resetAt: "2026-01-01T05:00:00.000Z" },
      ],
    },
    ledger: { lastSyncedAt: "2026-01-01T00:00:00.000Z", recordCount: 10 },
    demo: false,
  };
  const html = render(context("zh"), custom);
  assert.match(html, /Acme &lt;Corp&gt;/);
  assert.doesNotMatch(html, /<Corp>/);
  assert.match(html, /aria-valuenow="42"/);
  assert.match(html, /42%/);
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
  assert.match(css, /\.button--primary/);
  assert.match(css, /\[data-theme="dark"\]/);
  assert.match(css, /border-top:\s*0/);
  assert.doesNotMatch(css, /border-radius:\s*1[024]px[\s\S]{0,80}box-shadow/, "减少卡片");
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
