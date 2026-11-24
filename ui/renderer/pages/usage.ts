/**
 * 用量页：历史用量热力图 + 总使用量卡 + 按天 Tokens 图/表。
 *
 * 历史用量来自 Claude 在本机记录的用量，不是网关流量统计。
 *
 * 总使用量按输入、输出与缓存读写的合计计算，不单列缓存写。按天图只画输入 + 输出，避免缓存读把柱形压平。
 *
 * 切换热力图区间只原地替换热力图与总使用量卡；切换按天区间/图表模式只替换
 * 按天卡片。页面仍只由 render(context) 返回字符串。
 */

import { escapeHtml } from "../components/html.ts";
import { iconSvg } from "../components/icons.ts";
import { renderPageHeader } from "../components/page-chrome.ts";
import type { UsageViewDto } from "../../shared/ipc.ts";
import type { PageContext } from "./types.ts";

export const USAGE_RANGES = ["30min", "1h", "1d"] as const;

export type UsageRange = (typeof USAGE_RANGES)[number];

export const DAILY_RANGES = [7, 30, 90] as const;

export type DailyRange = (typeof DAILY_RANGES)[number];

export type DailyMode = "chart" | "table";

export interface UsageRangeMeta {
  readonly id: UsageRange;
  /** 每格代表的时间桶长度（分钟）。 */
  readonly bucketMinutes: 30 | 60 | 1440;
  /** 覆盖天数：30min = 7 天，1h = 14 天，1d = 336 天。 */
  readonly days: 7 | 14 | 336;
  readonly columns: 24;
  readonly rows: 14;
  readonly cells: 336;
  readonly label: { readonly zh: string; readonly en: string };
}

export const USAGE_RANGE_META: Readonly<Record<UsageRange, UsageRangeMeta>> = {
  "30min": {
    id: "30min",
    bucketMinutes: 30,
    days: 7,
    columns: 24,
    rows: 14,
    cells: 336,
    label: { zh: "30 分钟", en: "30 min" },
  },
  "1h": {
    id: "1h",
    bucketMinutes: 60,
    days: 14,
    columns: 24,
    rows: 14,
    cells: 336,
    label: { zh: "1 小时", en: "1 hour" },
  },
  "1d": {
    id: "1d",
    bucketMinutes: 1440,
    days: 336,
    columns: 24,
    rows: 14,
    cells: 336,
    label: { zh: "1 天", en: "1 day" },
  },
};

/**
 * 热力图单元。value === null 表示该时间桶没有记录，渲染为低对比灰，不等同于 0。
 */
export interface HeatmapCell {
  /** 时间桶起点，ISO 8601。 */
  readonly at: string;
  /** 该桶的原始用量值；null = 无数据。 */
  readonly value: number | null;
  /** 展示强度 0–4；0 与 null 都渲染为空格。 */
  readonly level: number;
  /** 可读时间标签，供 title 属性使用。 */
  readonly label?: string;
  /** 单格明细；缺省时总使用量卡只显示总量。 */
  readonly detail?: UsageDetail | null;
}

/** 单格明细，字段与 core 的分桶明细一致。 */
export interface UsageDetail {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly webSearchRequests: number;
  /** 工具调用次数（官方账本 tools 计数合计）。 */
  readonly calls: number;
}

/** 按天聚合的一天；只含界面维度，token = 输入 + 输出。 */
export interface UsageDailyPoint {
  /** 本地日期 YYYY-MM-DD，与用量文件名同格式。 */
  readonly day: string;
  readonly chat: number;
  readonly cowork: number;
  readonly code: number;
}

/** 页面的本地视图状态：跨更新保留，重进页面时由调用方重置。 */
export interface UsageViewState {
  readonly heatmapRange: UsageRange;
  readonly dailyDays: DailyRange;
  readonly dailyMode: DailyMode;
}

export const DEFAULT_USAGE_STATE: UsageViewState = {
  heatmapRange: "30min",
  dailyDays: 30,
  dailyMode: "chart",
};

/** 区间说明：30min = 最近 7 天，1h = 最近 14 天（24 × 14 小时），1d = 最近 336 天。 */
export function renderRangeCaption(range: UsageRange, language: "zh" | "en"): string {
  const meta = USAGE_RANGE_META[range];
  if (language === "en") {
    const bucket = meta.bucketMinutes === 30 ? "30 min" : meta.bucketMinutes === 60 ? "1 hour" : "1 day";
    return `Last ${meta.days} days · ${bucket} per cell · ${meta.cells} cells`;
  }
  const bucket = meta.bucketMinutes === 30 ? "30 分钟" : meta.bucketMinutes === 60 ? "1 小时" : "1 天";
  return `最近 ${meta.days} 天 · 每格 ${bucket} · ${meta.cells} 格`;
}

/**
 * 渲染一个固定 24 列 × 14 行、336 格的热力图。
 * cells 缺省或不足时补空，超出时截断；不在渲染层伪造统计值。
 */
export function renderHeatmap(
  range: UsageRange,
  cells?: readonly HeatmapCell[],
): string {
  const meta = USAGE_RANGE_META[range];
  const normalized = Array.from({ length: meta.cells }, (_, index) => {
    const cell = cells?.[index];
    if (!cell) return emptyCell(range, index);
    return cellMarkup(range, index, cell);
  }).join("");

  const aria = `用量热力图：${meta.cells} 格，${meta.columns} 列 × ${meta.rows} 行，${meta.label.zh}区间`;
  return `<div class="usage-heatmap" role="img" data-role="usage-heatmap" data-usage-range="${range}" data-columns="${meta.columns}" data-rows="${meta.rows}" aria-label="${escapeHtml(aria)}">${normalized}</div>`;
}

interface UsageCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly historyTitle: string;
  readonly historyDescription: string;
  readonly ledgerPending: string;
  readonly ledgerRecords: (count: number) => string;
  readonly syncNow: string;
  readonly rangeAria: string;
  readonly legendLess: string;
  readonly legendMore: string;
  readonly dailyRange: (days: number) => string;
  readonly demoNote: string;
  readonly overallTitle: string;
  readonly overallReal: string;
  readonly overallInput: string;
  readonly overallOutput: string;
  readonly overallCacheRead: string;
  readonly overallCacheHitRate: string;
  readonly overallCalls: string;
  readonly overallScope: (days: number) => string;
  readonly overallSearches: (count: number) => string;
  readonly infoInput: string;
  readonly infoOutput: string;
  readonly infoCacheRead: string;
  readonly infoCacheHitRate: string;
  readonly infoRealTotal: string;
  readonly dailyTitle: string;
  readonly dailyDescription: string;
  readonly dailyCardTitle: string;
  readonly dailyCardDescription: (days: number) => string;
  readonly dailyRangeAria: string;
  readonly dailyModeAria: string;
  readonly dailyChartAria: string;
  readonly dailyTableAria: string;
  readonly dailyDate: string;
}

const COPY: Readonly<Record<"zh" | "en", UsageCopy>> = {
  zh: {
    eyebrow: "用量",
    title: "用量",
    description: "查看历史用量与按天趋势。数据来自 Claude 在本机记录的用量。",
    historyTitle: "历史用量",
    historyDescription: "数据来自 Claude 在本机记录的用量，包含所有使用场景，不限于网关。",
    ledgerPending: "暂无用量数据",
    ledgerRecords: (count) => `已统计 ${count} 条记录`,
    syncNow: "立即同步",
    rangeAria: "时间粒度",
    legendLess: "少",
    legendMore: "多",
    dailyRange: (days) => `${days} 天`,
    demoNote: "示例强度，非真实统计",
    overallTitle: "总使用量",
    overallReal: "实际消耗 Token",
    overallInput: "输入（未缓存）",
    overallOutput: "输出",
    overallCacheRead: "缓存读",
    overallCacheHitRate: "缓存命中率",
    overallCalls: "工具调用次数",
    overallScope: (days) => `最近 ${days} 天`,
    overallSearches: (count) => `${count.toLocaleString("en-US")} 次网页搜索`,
    infoInput: "未从提示缓存读取、也未写入提示缓存的输入 Token",
    infoOutput: "模型生成的 Token",
    infoCacheRead: "从提示缓存读取、无需重新处理的输入 Token",
    infoCacheHitRate: "缓存读 ÷（缓存读 + 输入未缓存）：输入中命中提示缓存的比例",
    infoRealTotal: "输入、输出与缓存读写的合计",
    dailyTitle: "按天用量",
    dailyDescription: "按使用场景统计的输入与输出 Token，用于观察用量趋势。",
    dailyCardTitle: "每日 Token",
    dailyCardDescription: (days) => `按使用场景统计的输入与输出 Token，最近 ${days} 天`,
    dailyRangeAria: "时间范围",
    dailyModeAria: "图表或表格",
    dailyChartAria: "按天用量柱状图",
    dailyTableAria: "表格",
    dailyDate: "日期",
  },
  en: {
    eyebrow: "Usage",
    title: "Usage",
    description:
      "Review usage history and daily trends. Data comes from usage recorded by Claude on this machine.",
    historyTitle: "Usage history",
    historyDescription:
      "Data comes from usage recorded by Claude on this machine, including every surface — not only the gateway.",
    ledgerPending: "No usage data yet",
    ledgerRecords: (count) => `${count} records counted`,
    syncNow: "Sync now",
    rangeAria: "Time granularity",
    legendLess: "Less",
    legendMore: "More",
    dailyRange: (days) => `${days} days`,
    demoNote: "Sample intensity — not real usage",
    overallTitle: "Total usage",
    overallReal: "real consumption tokens",
    overallInput: "Input (uncached)",
    overallOutput: "Output",
    overallCacheRead: "Cache read",
    overallCacheHitRate: "Cache hit rate",
    overallCalls: "Tool calls",
    overallScope: (days) => `Last ${days} days`,
    overallSearches: (count) => (count === 1 ? "1 web search" : `${count.toLocaleString("en-US")} web searches`),
    infoInput: "Input tokens not read from or written to the prompt cache",
    infoOutput: "Tokens generated by the model",
    infoCacheRead: "Input tokens read from the prompt cache instead of being processed again",
    infoCacheHitRate:
      "Cache read ÷ (cache read + uncached input): the share of input served from the prompt cache",
    infoRealTotal: "Fresh input + output + cache read + cache write; cache write is usually zero",
    dailyTitle: "Daily usage",
    dailyDescription: "Input and output tokens by tab, for spotting trends.",
    dailyCardTitle: "Tokens per day",
    dailyCardDescription: (days) => `Input and output tokens by tab, last ${days} days`,
    dailyRangeAria: "Time range",
    dailyModeAria: "Chart or table",
    dailyChartAria: "Tokens per day bar chart",
    dailyTableAria: "Table",
    dailyDate: "Date",
  },
};

export function render(
  context: PageContext,
  view: UsageViewDto,
  state: UsageViewState = DEFAULT_USAGE_STATE,
): string {
  activeView = view;
  activeState = { ...state };
  hoveredCellIndex = null;
  hoveredCellRange = null;
  const language = context.language === "en" ? "en" : "zh";
  const copy = COPY[language];
  activeDailySeries = buildDailySeries(view);
  const cells = viewCells(view);
  const ledger = renderLedgerStatus(view.lastSyncedAt, view.lastSyncDisplay, copy);
  const range = activeState.heatmapRange;

  const historySection = `<section class="usage-block usage-history" data-role="usage-history" aria-labelledby="usage-history-title">
      <header class="usage-block-head">
        <div class="usage-block-copy">
          <h2 id="usage-history-title">${iconSvg("history", "usage-block-icon")}<span>${escapeHtml(copy.historyTitle)}</span></h2>
          <p>${escapeHtml(copy.historyDescription)}</p>
        </div>
        <div class="usage-range-switch" role="group" aria-label="${escapeHtml(copy.rangeAria)}">
          ${USAGE_RANGES.map((item) => renderRangeButton(item, item === range, language)).join("")}
        </div>
      </header>

      <div class="usage-heatmap-meta">
        <span data-role="usage-range-caption">${escapeHtml(renderRangeCaption(range, language))}</span>
        <span class="usage-sync-group">
          <span class="usage-sync" data-role="usage-sync-status">${escapeHtml(ledger)}</span>
          <button type="button" class="usage-sync-button" data-role="usage-sync-button" aria-label="${escapeHtml(copy.syncNow)}" title="${escapeHtml(copy.syncNow)}">${iconSvg("refresh", "usage-sync-icon")}</button>
        </span>
      </div>
      <p class="usage-warning" data-role="usage-warning"${view.warnings.length === 0 ? " hidden" : ""}>${escapeHtml(view.warnings.join(" "))}</p>
      <div class="usage-heat-row">
        <div class="usage-heatmap-host" data-role="usage-heatmap-host">${renderHeatmap(range, cells)}</div>
        <aside class="usage-overall" data-role="usage-overall" aria-label="${escapeHtml(copy.overallTitle)}">${renderOverallCard(cells, range, copy)}</aside>
      </div>
      <div class="usage-heatmap-foot">
        <div class="usage-legend">
          <span class="usage-legend-label">${escapeHtml(copy.legendLess)}</span>
          <span class="usage-legend-scale" aria-hidden="true">
            ${[0, 1, 2, 3, 4].map((level) => `<span class="usage-legend-cell is-level-${level}"></span>`).join("")}
          </span>
          <span class="usage-legend-label">${escapeHtml(copy.legendMore)}</span>
        </div>
      </div>
    </section>`;

  const dailySection = `<section class="usage-block usage-block--continuous usage-daily" data-role="usage-daily" aria-labelledby="usage-daily-title">
      <header class="usage-block-head">
        <div class="usage-block-copy">
          <h2 id="usage-daily-title">${iconSvg("history", "usage-block-icon")}<span>${escapeHtml(copy.dailyTitle)}</span></h2>
          <p>${escapeHtml(copy.dailyDescription)}</p>
        </div>
      </header>
      <div class="usage-daily-card" data-role="usage-daily-card">${renderDailyCard(activeDailySeries, activeState.dailyDays, activeState.dailyMode, language, copy)}</div>
    </section>`;

  return `<article class="page page--usage" data-role="page-usage" data-usage-language="${language}">
    ${renderPageHeader({
      eyebrow: copy.eyebrow,
      title: copy.title,
      description: copy.description,
    })}
    ${historySection}
    ${dailySection}
  </article>`;
}

interface OverallTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly webSearchRequests: number;
  readonly calls: number;
  readonly realTotal: number;
}

function sumCells(cells: readonly HeatmapCell[] | undefined): OverallTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let webSearchRequests = 0;
  let calls = 0;

  for (const cell of cells ?? []) {
    if (!cell.detail) continue;
    inputTokens += cell.detail.inputTokens;
    outputTokens += cell.detail.outputTokens;
    cacheReadTokens += cell.detail.cacheReadTokens;
    cacheWriteTokens += cell.detail.cacheWriteTokens;
    webSearchRequests += cell.detail.webSearchRequests;
    calls += cell.detail.calls;
  }

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    webSearchRequests,
    calls,
    realTotal: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
  };
}

function renderOverallCard(
  cells: readonly HeatmapCell[] | undefined,
  range: UsageRange,
  copy: UsageCopy,
): string {
  const totals = sumCells(cells);
  const scope = copy.overallScope(USAGE_RANGE_META[range].days);
  return renderOverallContent(totals, scope, copy);
}

function renderOverallContent(
  totals: OverallTotals,
  scope: string,
  copy: UsageCopy,
): string {
  const head = `<header class="usage-overall-head">
      <span class="usage-overall-label">${escapeHtml(copy.overallTitle)} ${renderInfo(copy.infoRealTotal)}</span>
      <span class="usage-overall-scope">${escapeHtml(scope)}</span>
    </header>`;

  const tokenText = (value: number): string => formatFull(value);
  const countText = (value: number): string => formatFull(value);
  const hitRateText = (value: OverallTotals): string => {
    const denominator = value.cacheReadTokens + value.inputTokens;
    return denominator === 0
      ? "—"
      : `${((value.cacheReadTokens / denominator) * 100).toFixed(2)}%`;
  };
  const rows: readonly (readonly [string, string | number, string | null])[] = [
    [copy.overallInput, tokenText(totals.inputTokens), copy.infoInput],
    [copy.overallOutput, tokenText(totals.outputTokens), copy.infoOutput],
    [copy.overallCacheRead, tokenText(totals.cacheReadTokens), copy.infoCacheRead],
    [copy.overallCacheHitRate, hitRateText(totals), copy.infoCacheHitRate],
    [copy.overallCalls, countText(totals.calls), null],
  ];
  const valueText = (value: string | number): string =>
    typeof value === "string" ? value : formatFull(value);

  return `${head}
    <div class="usage-overall-total">${escapeHtml(formatTokens(totals.realTotal))}</div>
    <div class="usage-overall-caption">${escapeHtml(copy.overallReal)}</div>
    <dl class="usage-overall-rows">
      ${rows
        .map(
          ([label, value, hint]) => `<div class="usage-overall-row">
            <dt>${escapeHtml(label)}${hint ? ` ${renderInfo(hint)}` : ""}</dt>
            <dd>${escapeHtml(valueText(value))}</dd>
          </div>`,
        )
        .join("")}
    </dl>
    <p class="usage-overall-searches">${escapeHtml(copy.overallSearches(totals.webSearchRequests))}</p>`;
}

function formatCellScope(at: string, range: UsageRange, language: "zh" | "en"): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  const dateText = formatDate(date, language, false);
  if (USAGE_RANGE_META[range].bucketMinutes === 1440) return dateText;
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${dateText} ${hours}:${minutes}`;
}

function renderInfo(text: string): string {
  return `<button type="button" class="usage-info" aria-label="${escapeHtml(text)}"><span class="usage-tip">${escapeHtml(text)}</span></button>`;
}

interface DailyPoint extends UsageDailyPoint {
  readonly date: Date;
  readonly total: number;
  /** 图表用的柱顶 SVG y；由 renderDailyChart 写入。 */
  top?: number;
}

let activeView: UsageViewDto | null = null;
let activeState: UsageViewState = { ...DEFAULT_USAGE_STATE };
let hoveredCellIndex: number | null = null;
let hoveredCellRange: UsageRange | null = null;
let activeDailySeries: DailyPoint[] = [];
let interactionsInstalled = false;

function viewCells(view: UsageViewDto): HeatmapCell[] {
  return view.heatmap.map((bucket) => ({
    at: bucket.start,
    value: bucket.value,
    level: bucket.level,
    label: bucket.label,
    detail: bucket.detail,
  }));
}

/** DTO 的 daily 已经是“最近 N 天、由远到近”的完整序列。 */
function buildDailySeries(view: UsageViewDto): DailyPoint[] {
  return view.daily.map((point) => {
    const date = new Date(`${point.day}T00:00:00`);
    return {
      date,
      day: point.day,
      chat: point.chat,
      cowork: point.cowork,
      code: point.code,
      total: point.chat + point.cowork + point.code,
    };
  });
}

function renderDailyCard(
  series: readonly DailyPoint[],
  range: DailyRange,
  mode: DailyMode,
  language: "zh" | "en",
  copy: UsageCopy,
): string {
  const body =
    mode === "table"
      ? renderDailyTable(series, language, copy)
      : renderDailyChart(series, language, copy);

  return `<header class="usage-daily-head">
      <div class="usage-daily-copy">
        <h3>${escapeHtml(copy.dailyCardTitle)}</h3>
        <p>${escapeHtml(copy.dailyCardDescription(range))}</p>
      </div>
      <div class="usage-daily-tools">
        <div class="usage-range-switch" role="group" aria-label="${escapeHtml(copy.dailyRangeAria)}">
          ${DAILY_RANGES.map(
            (item) =>
              `<button type="button" class="usage-range-button${item === range ? " is-active" : ""}" data-chart-range="${item}" aria-pressed="${item === range}">${escapeHtml(copy.dailyRange(item))}</button>`,
          ).join("")}
        </div>
        ${renderDailyModeSwitch(mode, copy)}
      </div>
    </header>
    <div class="usage-daily-legend">
      <span><i class="usage-legend-dot usage-legend-dot--chat"></i>Chat</span>
      <span><i class="usage-legend-dot usage-legend-dot--cowork"></i>Cowork</span>
      <span><i class="usage-legend-dot usage-legend-dot--code"></i>Code</span>
    </div>
    ${body}`;
}

function renderDailyModeSwitch(mode: DailyMode, copy: UsageCopy): string {
  const button = (value: DailyMode, label: string, icon: string): string =>
    `<button type="button" class="${value === mode ? "is-active" : ""}" data-chart-mode="${value}" aria-pressed="${value === mode}" aria-label="${escapeHtml(label)}">${icon}</button>`;

  return `<div class="usage-mode-switch" role="group" aria-label="${escapeHtml(copy.dailyModeAria)}">
    ${button(
      "chart",
      copy.dailyChartAria,
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5M4 19h16"/><path d="M7 15l4-4 3 2 5-6"/></svg>',
    )}
    ${button(
      "table",
      copy.dailyTableAria,
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M9 10v9"/></svg>',
    )}
  </div>`;
}

const CHART_WIDTH = 760;
const CHART_HEIGHT = 260;
const CHART_PAD = { left: 52, right: 10, top: 12, bottom: 30 };

function renderDailyChart(series: readonly DailyPoint[], language: "zh" | "en", copy: UsageCopy): string {
  const plotWidth = CHART_WIDTH - CHART_PAD.left - CHART_PAD.right;
  const plotHeight = CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom;
  const plotBottom = CHART_PAD.top + plotHeight;
  const max = Math.max(...series.map((point) => point.total), 1);
  const step = niceStep(max / 4);
  const axisMax = step * 4;
  const y = (value: number): number => plotBottom - (value / axisMax) * plotHeight;

  let content = "";
  for (let tick = 0; tick <= 4; tick += 1) {
    const lineY = y(step * tick);
    content += `<line class="usage-chart-grid" x1="${CHART_PAD.left}" y1="${lineY}" x2="${CHART_WIDTH - CHART_PAD.right}" y2="${lineY}" />`;
    content += `<text class="usage-chart-axis" x="${CHART_PAD.left - 10}" y="${lineY + 4}" text-anchor="end">${formatTokens(step * tick)}</text>`;
  }

  const band = plotWidth / series.length;
  const barWidth = Math.max(3, Math.min(22, band * 0.62));

  series.forEach((point, index) => {
    const x = CHART_PAD.left + index * band + (band - barWidth) / 2;
    let bottom = plotBottom;
    const segments: Array<["chat" | "cowork" | "code", number]> = [
      ["chat", point.chat],
      ["cowork", point.cowork],
      ["code", point.code],
    ];
    const parts = segments
      .map(([surface, value]) => {
        if (value <= 0) return "";
        const height = (value / axisMax) * plotHeight;
        const top = bottom - height;
        const rect = `<rect class="usage-bar usage-bar--${surface}" x="${x.toFixed(2)}" y="${top.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${height.toFixed(2)}" rx="1.5" />`;
        bottom = top;
        return rect;
      })
      .join("");
    point.top = y(point.total);
    content += parts;
    content += `<rect class="usage-chart-band" x="${(CHART_PAD.left + index * band).toFixed(2)}" y="${CHART_PAD.top}" width="${band.toFixed(2)}" height="${plotHeight}" />`;
  });

  const labelCount = series.length <= 7 ? series.length : series.length <= 30 ? 6 : 7;
  const stride = Math.max(1, Math.round((series.length - 1) / Math.max(1, labelCount - 1)));
  const indices: number[] = [];
  for (let index = 0; index < series.length; index += stride) indices.push(index);
  if (indices[indices.length - 1] !== series.length - 1) indices.push(series.length - 1);

  for (const index of indices) {
    const point = series[index];
    if (!point) continue;
    const x = CHART_PAD.left + index * band + band / 2;
    content += `<text class="usage-chart-axis" x="${x.toFixed(2)}" y="${CHART_HEIGHT - 8}" text-anchor="middle">${escapeHtml(formatDate(point.date, language, false))}</text>`;
  }

  return `<div class="usage-chart-host" data-role="usage-chart-host" data-lang="${language}">
    <svg class="usage-chart-svg" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="${escapeHtml(copy.dailyChartAria)}">${content}</svg>
    <div class="usage-chart-tip" data-role="usage-chart-tip" hidden></div>
  </div>`;
}

function renderDailyTable(series: readonly DailyPoint[], language: "zh" | "en", copy: UsageCopy): string {
  const rows = series
    .map(
      (point) => `<tr>
        <td>${escapeHtml(formatDate(point.date, language, true))}</td>
        <td>${escapeHtml(formatTokens(point.chat))}</td>
        <td>${escapeHtml(formatTokens(point.cowork))}</td>
        <td>${escapeHtml(formatTokens(point.code))}</td>
      </tr>`,
    )
    .join("");

  return `<div class="usage-table-wrap" data-role="usage-table-wrap">
    <table class="usage-data-table">
      <thead>
        <tr>
          <th>${escapeHtml(copy.dailyDate)}</th>
          <th>Chat</th>
          <th>Cowork</th>
          <th>Code</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function applyView(view: UsageViewDto, state: UsageViewState): void {
  activeView = view;
  activeState = { ...state };
  activeDailySeries = buildDailySeries(view);
}

function languageOf(root: HTMLElement): "zh" | "en" {
  return root.dataset.usageLanguage === "en" ? "en" : "zh";
}

function renderOverallInto(root: HTMLElement, copy: UsageCopy): void {
  const host = root.querySelector<HTMLElement>('[data-role="usage-overall"]');
  if (!host || activeView === null) return;
  host.innerHTML = renderOverallCard(viewCells(activeView), activeState.heatmapRange, copy);
}

/** 只替换热力图区：格子、区间说明、同步状态与区间按钮。 */
export function updateUsageHeatmap(
  root: HTMLElement,
  view: UsageViewDto,
  state: UsageViewState,
): void {
  applyView(view, state);
  const language = languageOf(root);
  const range = state.heatmapRange;
  const host = root.querySelector<HTMLElement>('[data-role="usage-heatmap-host"]');
  if (host) host.innerHTML = renderHeatmap(range, viewCells(view));

  const caption = root.querySelector<HTMLElement>('[data-role="usage-range-caption"]');
  if (caption) caption.textContent = renderRangeCaption(range, language);

  const sync = root.querySelector<HTMLElement>('[data-role="usage-sync-status"]');
  if (sync) {
    sync.textContent = renderLedgerStatus(view.lastSyncedAt, view.lastSyncDisplay, copyFor(language));
  }

  const warning = root.querySelector<HTMLElement>('[data-role="usage-warning"]');
  if (warning) {
    warning.textContent = view.warnings.join(" ");
    warning.hidden = view.warnings.length === 0;
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-usage-range]")) {
    const active = button.dataset.usageRange === range;
    button.setAttribute("aria-pressed", String(active));
    button.classList.toggle("is-active", active);
  }

  hoveredCellIndex = null;
  hoveredCellRange = null;
}

/** 只替换总使用量卡。 */
export function updateUsageOverall(
  root: HTMLElement,
  view: UsageViewDto,
  state: UsageViewState,
): void {
  applyView(view, state);
  renderOverallInto(root, copyFor(languageOf(root)));
}

/** 只替换按天卡片（含 7/30/90 与图表/表格按钮）。 */
export function updateUsageDaily(
  root: HTMLElement,
  view: UsageViewDto,
  state: UsageViewState,
): void {
  applyView(view, state);
  const card = root.querySelector<HTMLElement>('[data-role="usage-daily-card"]');
  if (!card) return;
  const language = languageOf(root);
  card.innerHTML = renderDailyCard(
    activeDailySeries,
    state.dailyDays,
    state.dailyMode,
    language,
    copyFor(language),
  );
}

/** 三块一起更新；用于数据 revision 变化后的整体刷新。 */
export function updateUsageView(
  root: HTMLElement,
  view: UsageViewDto,
  state: UsageViewState,
): void {
  updateUsageHeatmap(root, view, state);
  updateUsageOverall(root, view, state);
  updateUsageDaily(root, view, state);
}

function showCellOverall(
  page: HTMLElement,
  index: number,
  language: "zh" | "en",
): void {
  const host = page.querySelector<HTMLElement>('[data-role="usage-overall"]');
  if (!host || activeView === null) return;
  const cell = viewCells(activeView)[index];
  if (!cell) return;
  host.innerHTML = renderOverallContent(
    sumCells([cell]),
    cell.label ?? formatCellScope(cell.at, activeState.heatmapRange, language),
    copyFor(language),
  );
}

function copyFor(language: "zh" | "en"): UsageCopy {
  return COPY[language];
}

function renderChartTip(tip: HTMLElement, point: DailyPoint, language: "zh" | "en"): void {
  const rows: Array<["chat" | "cowork" | "code", number, string]> = [
    ["chat", point.chat, "Chat"],
    ["cowork", point.cowork, "Cowork"],
    ["code", point.code, "Code"],
  ];
  tip.innerHTML = `<div class="usage-chart-tip-date">${escapeHtml(formatDate(point.date, language, true))}</div>
    ${rows
      .map(
        ([surface, value, label]) => `<div class="usage-chart-tip-row">
          <i class="usage-legend-dot usage-legend-dot--${surface}"></i>
          <span class="usage-chart-tip-value">${escapeHtml(formatTokens(value))}</span>
          <span class="usage-chart-tip-name">${label}</span>
        </div>`,
      )
      .join("")}`;
}

function installUsageInteractions(): void {
  if (interactionsInstalled || typeof document === "undefined") return;
  interactionsInstalled = true;

  document.addEventListener("mousemove", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const page = target.closest<HTMLElement>('[data-role="page-usage"]');
    if (!page) return;

    const language = page.dataset.usageLanguage === "en" ? "en" : "zh";
    const cell = target.closest<HTMLElement>("[data-usage-cell]");
    const heatHost = cell?.closest('[data-role="usage-heatmap-host"]');

    if (cell && heatHost) {
      const index = Number(cell.dataset.usageCell);
      if (!Number.isInteger(index)) return;
      if (hoveredCellIndex === index && hoveredCellRange === activeState.heatmapRange) return;
      hoveredCellIndex = index;
      hoveredCellRange = activeState.heatmapRange;
      showCellOverall(page, index, language);
      return;
    }

    if (hoveredCellIndex !== null) {
      hoveredCellIndex = null;
      hoveredCellRange = null;
      renderOverallInto(page, copyFor(language));
    }
  });

  document.documentElement.addEventListener("mouseleave", () => {
    hoveredCellIndex = null;
    hoveredCellRange = null;
    const page = document.querySelector<HTMLElement>('[data-role="page-usage"]');
    if (!page) return;
    const language = page.dataset.usageLanguage === "en" ? "en" : "zh";
    renderOverallInto(page, copyFor(language));
  });

  document.addEventListener("pointermove", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const host = target.closest<HTMLElement>('[data-role="usage-chart-host"]');
    const tip = document.querySelector<HTMLElement>('[data-role="usage-chart-tip"]');
    if (!host) {
      if (tip) tip.hidden = true;
      return;
    }

    const svg = host.querySelector<SVGSVGElement>("svg");
    if (!svg || !tip || activeDailySeries.length === 0) return;

    const rect = svg.getBoundingClientRect();
    const scale = rect.width / CHART_WIDTH;
    const left = CHART_PAD.left * scale;
    const right = CHART_PAD.right * scale;
    const plot = rect.width - left - right;
    const x = event.clientX - rect.left;
    if (x < left || x > left + plot) {
      tip.hidden = true;
      return;
    }

    const band = plot / activeDailySeries.length;
    const index = Math.max(0, Math.min(activeDailySeries.length - 1, Math.floor((x - left) / band)));
    const point = activeDailySeries[index];
    if (!point) return;

    const language = host.dataset.lang === "en" ? "en" : "zh";
    renderChartTip(tip, point, language);
    tip.hidden = false;

    const hostRect = host.getBoundingClientRect();
    const scaleY = rect.height / CHART_HEIGHT;
    const barTop = rect.top - hostRect.top + (point.top ?? CHART_PAD.top) * scaleY;
    const bandLeft = left + index * band;
    const bandRight = bandLeft + band;

    let tipLeft = bandRight + 8;
    if (tipLeft + tip.offsetWidth > hostRect.width - 4) {
      tipLeft = bandLeft - tip.offsetWidth - 8;
    }
    tipLeft = Math.max(4, Math.min(hostRect.width - tip.offsetWidth - 4, tipLeft));

    let tipTop = barTop - tip.offsetHeight - 10;
    if (tipTop < 4) tipTop = barTop + 12;
    tipTop = Math.max(4, Math.min(hostRect.height - tip.offsetHeight - 4, tipTop));

    tip.style.left = `${tipLeft}px`;
    tip.style.top = `${tipTop}px`;
  });

  document.documentElement.addEventListener("pointerleave", () => {
    const tip = document.querySelector<HTMLElement>('[data-role="usage-chart-tip"]');
    if (tip) tip.hidden = true;
  });
}

/** usage.css 优先使用 index.html 的共享链接；缺失时由本模块补挂。 */
function installUsageStyles(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector('link[data-usage-styles="true"], link[href$="pages/usage.css"]')) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./pages/usage.css";
  link.dataset.usageStyles = "true";
  document.head.append(link);
}

function renderRangeButton(range: UsageRange, active: boolean, language: "zh" | "en"): string {
  return `<button type="button" class="usage-range-button${active ? " is-active" : ""}" data-usage-range="${range}" aria-pressed="${active}">${escapeHtml(USAGE_RANGE_META[range].label[language])}</button>`;
}

function renderLedgerStatus(
  lastSyncedAt: string | null,
  lastSyncDisplay: string | null | undefined,
  copy: UsageCopy,
): string {
  // 精确到分钟：lastSyncDisplay 已是本地时间（YYYY-MM-DD HH:mm:ss）。
  const display =
    lastSyncDisplay ??
    (lastSyncedAt === null ? null : lastSyncedAt.slice(0, 16).replace("T", " "));
  return display === null || display.length === 0 ? copy.ledgerPending : display.slice(0, 16);
}

function emptyCell(range: UsageRange, index: number): string {
  return `<span class="usage-cell usage-cell--empty is-level-0" data-usage-cell="${index}" data-level="0" title="${escapeHtml(`${USAGE_RANGE_META[range].label.en} · ${index + 1}`)}" aria-hidden="true"></span>`;
}

function cellMarkup(range: UsageRange, index: number, cell: HeatmapCell): string {
  const level = normalizeLevel(cell.level);
  if (cell.value === null || level === 0) {
    const label = cell.label ?? `${USAGE_RANGE_META[range].label.en} · ${index + 1}`;
    return `<span class="usage-cell usage-cell--empty is-level-0" data-usage-cell="${index}" data-level="0" title="${escapeHtml(label)}" aria-hidden="true"></span>`;
  }
  const label = cell.label ?? cell.at;
  return `<span class="usage-cell is-level-${level}" data-usage-cell="${index}" data-level="${level}" title="${escapeHtml(label)}" aria-hidden="true"></span>`;
}

function normalizeLevel(value: number): 0 | 1 | 2 | 3 | 4 {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  if (rounded < 1) return 0;
  if (rounded > 4) return 4;
  return rounded as 1 | 2 | 3 | 4;
}

function formatFull(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatTokens(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `${trimDecimal(value / 1_000_000_000, 2)}B`;
  if (value >= 1_000_000) return `${trimDecimal(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimDecimal(value / 1_000)}K`;
  return String(Math.round(value));
}

function trimDecimal(value: number, digits = 1): string {
  return String(Number(value.toFixed(digits)));
}

function formatDate(date: Date, language: "zh" | "en", withYear: boolean): string {
  if (Number.isNaN(date.getTime())) return "—";
  const locale = language === "en" ? "en-US" : "zh-CN";
  return date.toLocaleDateString(locale, {
    month: language === "en" ? "short" : "long",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/** 把轴上限抬到 1/2/2.5/5/10 的整倍数，保证四条刻度线可读。 */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exponent = Math.floor(Math.log10(raw));
  const base = 10 ** exponent;
  const value = raw / base;
  const step = value <= 1 ? 1 : value <= 2 ? 2 : value <= 2.5 ? 2.5 : value <= 5 ? 5 : 10;
  return step * base;
}

// 页面级交互（热力图悬停、图表浮窗）只安装一次；模块加载即生效。
installUsageInteractions();
