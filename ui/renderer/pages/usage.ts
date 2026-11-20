/**
 * 用量页：额度区 + 历史用量热力图。
 *
 * quota 的 null 表示"未知"，绝不渲染估值或假进度；历史用量来自 Claude 应用
 * 写入本机的 usage-ledger 账本，不是网关流量统计。
 *
 * 切换 30min / 1h / 1d 只原地替换热力图 host 与文案，页头、额度区不重绘；
 * 点击由一次性的 document 事件委托处理，页面仍只由 render(context) 返回字符串。
 */

import { escapeHtml } from "../components/html.ts";
import { iconSvg } from "../components/icons.ts";
import { DEMO_USAGE_PROFILES } from "../state/usage-profiles.ts";
import {
  renderActionButton,
  renderPageHeader,
} from "../components/page-chrome.ts";
import type { PageContext } from "./types.ts";

/* ------------------------------------------------------------------ */
/* 公共接口                                                            */
/* ------------------------------------------------------------------ */

export const USAGE_RANGES = ["30min", "1h", "1d"] as const;

export type UsageRange = (typeof USAGE_RANGES)[number];

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
}

export interface UsageQuotaWindow {
  readonly id: string;
  readonly label: string;
  /** 已用百分比 0–100；null = 尚未接入，不显示假进度。 */
  readonly usedPercent: number | null;
  /** 重置时间 ISO 8601；null = 未知。 */
  readonly resetAt: string | null;
}

export interface UsageQuota {
  readonly status: "unlinked" | "ready";
  /** 账户余额（美元）；null = 未知，界面显示占位符。 */
  readonly balanceUsd: number | null;
  /** 剩余额度（美元）；null = 未知。 */
  readonly remainingUsd: number | null;
  readonly windows: readonly UsageQuotaWindow[];
}

export interface UsageProfileOption {
  readonly id: string;
  readonly label: string;
  /** 可选副标题，例如"每 30 分钟"或"待接入"。 */
  readonly detail?: string;
}

export interface UsageLedgerState {
  /** 最近一次账本同步时间 ISO 8601；null = 尚未同步。 */
  readonly lastSyncedAt: string | null;
  /** 镜像账本行数；null = 未知。 */
  readonly recordCount: number | null;
}

export interface UsageViewData {
  readonly profiles: readonly UsageProfileOption[];
  readonly selectedProfileId: string;
  readonly quota: UsageQuota;
  readonly ledger: UsageLedgerState;
  /** 真实聚合数据，每个区间按需最多 336 格；缺省即空热力图。 */
  readonly heatmap?: Partial<Record<UsageRange, readonly HeatmapCell[]>>;
  /** true 时使用确定性演示强度，并在界面明确标注"示例"。 */
  readonly demo?: boolean;
}

/** 默认视图数据：额度全部未知，历史用量不含任何真实统计。 */
export function buildUsageViewData(language: "zh" | "en"): UsageViewData {
  const zh = language === "zh";
  return {
    profiles: DEMO_USAGE_PROFILES.map((profile) => ({
      id: profile.id,
      label: profile.name,
      detail: profile.summary,
    })),
    selectedProfileId: DEMO_USAGE_PROFILES[0]?.id ?? "",
    quota: {
      status: "unlinked",
      balanceUsd: null,
      remainingUsd: null,
      windows: [
        { id: "five_hour", label: zh ? "5 小时额度" : "5-hour limit", usedPercent: null, resetAt: null },
        { id: "weekly", label: zh ? "每周额度" : "Weekly limit", usedPercent: null, resetAt: null },
        { id: "extra", label: zh ? "额外用量" : "Extra usage", usedPercent: null, resetAt: null },
      ],
    },
    ledger: { lastSyncedAt: null, recordCount: null },
    demo: true,
  };
}

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

  const aria = `Usage heatmap: ${meta.cells} cells, ${meta.columns} columns × ${meta.rows} rows, ${range} range`;
  return `<div class="usage-heatmap" role="img" data-role="usage-heatmap" data-usage-range="${range}" data-columns="${meta.columns}" data-rows="${meta.rows}" aria-label="${escapeHtml(aria)}">${normalized}</div>`;
}

/** 确定性演示强度：界面必须同时标注"示例"。 */
export function createDemoCells(range: UsageRange): HeatmapCell[] {
  const meta = USAGE_RANGE_META[range];
  const anchor = Date.UTC(2026, 0, 1);
  const bucketMs = meta.bucketMinutes * 60_000;

  return Array.from({ length: meta.cells }, (_, index) => {
    const at = new Date(anchor - (meta.cells - 1 - index) * bucketMs).toISOString();
    const level = demoLevel(range, index);
    return {
      at,
      value: level === 0 ? null : level * 7,
      level,
      label: `${meta.label.en} · cell ${index + 1}`,
    };
  });
}

/* ------------------------------------------------------------------ */
/* 页面渲染                                                            */
/* ------------------------------------------------------------------ */

interface UsageCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly quotaTitle: string;
  readonly quotaDescription: string;
  readonly profileLabel: string;
  readonly profileAria: string;
  readonly accountSettings: string;
  readonly balance: string;
  readonly remaining: string;
  readonly windowReset: string;
  readonly pending: string;
  readonly quotaNote: string;
  readonly historyTitle: string;
  readonly historyDescription: string;
  readonly ledgerPending: string;
  readonly ledgerRecords: (count: number) => string;
  readonly rangeAria: string;
  readonly cellsNote: string;
  readonly demoNote: string;
  readonly note: string;
}

const COPY: Readonly<Record<"zh" | "en", UsageCopy>> = {
  zh: {
    eyebrow: "用量",
    title: "用量",
    description: "查看额度与历史用量。额度等待官方接口，历史来自本机 Claude 用量账本。",
    quotaTitle: "额度",
    quotaDescription: "余额与额度窗口由所选配置文件读取；原型阶段只保留明确位置，不显示估值。",
    profileLabel: "配置文件",
    profileAria: "选择配置文件",
    accountSettings: "账户设置",
    balance: "账户余额",
    remaining: "剩余额度",
    windowReset: "重置时间",
    pending: "等待接口",
    quotaNote: "接入官方额度接口后显示余额、剩余额度与各窗口进度；在此之前保持占位，不做估算。",
    historyTitle: "历史用量",
    historyDescription:
      "数据来自 Claude 应用写入本机的用量账本（usage-ledger），不是网关流量统计。",
    ledgerPending: "账本尚未同步",
    ledgerRecords: (count) => `${count} 条记录`,
    rangeAria: "时间粒度",
    cellsNote: "固定 24 列 × 14 行、336 格；空格为低对比灰。",
    demoNote: "示例强度，非真实统计",
    note: "原型：额度与历史用量只定义接口和布局，不读取真实数据。",
  },
  en: {
    eyebrow: "Usage",
    title: "Usage",
    description:
      "Review limits and history. Limits wait for the official API; history comes from the local Claude usage ledger.",
    quotaTitle: "Limits",
    quotaDescription:
      "Balances and limit windows are read through the selected profile. This prototype keeps the slots and never shows estimates.",
    profileLabel: "Profile",
    profileAria: "Choose a profile",
    accountSettings: "Account settings",
    balance: "Account balance",
    remaining: "Remaining",
    windowReset: "Resets",
    pending: "Waiting for API",
    quotaNote:
      "Balances, remaining quota and window progress appear once the official limits API is connected. Until then they stay placeholders, never estimates.",
    historyTitle: "Usage history",
    historyDescription:
      "Data comes from the Claude usage-ledger written on this machine, not gateway traffic statistics.",
    ledgerPending: "Ledger not synced",
    ledgerRecords: (count) => `${count} records`,
    rangeAria: "Time granularity",
    cellsNote: "Fixed 24 columns × 14 rows, 336 cells; empty cells are low-contrast gray.",
    demoNote: "Sample intensity — not real usage",
    note: "Prototype: limits and history define interfaces and layout only; no real data is read.",
  },
};

const DEFAULT_RANGE: UsageRange = "1h";

export function render(
  context: PageContext,
  data: UsageViewData = buildUsageViewData(context.language),
): string {
  activeUsageData = data;
  const language = context.language === "en" ? "en" : "zh";
  const copy = COPY[language];
  const range: UsageRange = DEFAULT_RANGE;
  const cells = cellsFor(data, range);
  const ledger = renderLedgerStatus(data.ledger, copy);

  const quotaSection = `<section class="usage-block usage-quota" data-role="usage-quota" aria-labelledby="usage-quota-title">
      <header class="usage-block-head">
        <div class="usage-block-copy">
          <h2 id="usage-quota-title">${iconSvg("quota", "usage-block-icon")}<span>${escapeHtml(copy.quotaTitle)}</span></h2>
          <p>${escapeHtml(copy.quotaDescription)}</p>
        </div>
        <div class="usage-block-actions">
          ${renderProfileSelector(data, copy)}
          ${renderActionButton({
            label: copy.accountSettings,
            action: "settings",
            section: "usage",
            source: "usage-quota",
            variant: "primary",
          })}
        </div>
      </header>

      <div class="usage-quota-grid">
        <div class="usage-balance">
          <div class="usage-balance-metric">
            <span class="usage-label">${escapeHtml(copy.balance)}</span>
            <span class="usage-value" data-usage-balance>${escapeHtml(formatUsd(data.quota.balanceUsd))}</span>
          </div>
          <div class="usage-balance-metric">
            <span class="usage-label">${escapeHtml(copy.remaining)}</span>
            <span class="usage-value" data-usage-remaining>${escapeHtml(formatUsd(data.quota.remainingUsd))}</span>
          </div>
        </div>
        <div class="usage-quota-windows">
          ${data.quota.windows.map((window) => renderQuotaWindow(window, copy)).join("")}
        </div>
      </div>
    </section>`;

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

      <div class="usage-heatmap-block">
        <div class="usage-heatmap-meta">
          <span data-role="usage-range-caption">${escapeHtml(renderRangeCaption(range, language))}</span>
          <span class="usage-ledger" data-role="usage-ledger-status">${escapeHtml(ledger)}</span>
        </div>
        <div class="usage-heatmap-host" data-role="usage-heatmap-host">${renderHeatmap(range, cells)}</div>
        <div class="usage-heatmap-foot">
          <div class="usage-legend">
            <span class="usage-legend-label">Less</span>
            <span class="usage-legend-scale" aria-hidden="true">
              ${[0, 1, 2, 3, 4].map((level) => `<span class="usage-legend-cell is-level-${level}"></span>`).join("")}
            </span>
            <span class="usage-legend-label">More</span>
          </div>
          ${data.demo ? `<span class="usage-demo-note">${escapeHtml(copy.demoNote)}</span>` : ""}
        </div>
      </div>
    </section>`;

  return `<article class="page page--usage" data-role="page-usage" data-usage-language="${language}">
    ${renderPageHeader({
      eyebrow: copy.eyebrow,
      title: copy.title,
      description: copy.description,
    })}
    ${historySection}
    ${quotaSection}
  </article>`;
}

/* ------------------------------------------------------------------ */
/* 热力图切换：只更新 host 与文案                                      */
/* ------------------------------------------------------------------ */

let activeUsageData: UsageViewData | null = null;
let interactionsInstalled = false;

function cellsFor(data: UsageViewData, range: UsageRange): readonly HeatmapCell[] | undefined {
  return data.heatmap?.[range] ?? (data.demo ? createDemoCells(range) : undefined);
}

function updateHeatmap(page: HTMLElement, range: UsageRange): void {
  const host = page.querySelector<HTMLElement>('[data-role="usage-heatmap-host"]');
  if (!host) return;

  const language = page.dataset.usageLanguage === "en" ? "en" : "zh";
  const data = activeUsageData;
  const cells = data ? cellsFor(data, range) : undefined;

  host.innerHTML = renderHeatmap(range, cells);

  const caption = page.querySelector<HTMLElement>('[data-role="usage-range-caption"]');
  if (caption) caption.textContent = renderRangeCaption(range, language);

  for (const button of page.querySelectorAll<HTMLButtonElement>("button[data-usage-range]")) {
    const active = button.dataset.usageRange === range;
    button.setAttribute("aria-pressed", String(active));
    button.classList.toggle("is-active", active);
  }
}

function installUsageInteractions(): void {
  if (interactionsInstalled || typeof document === "undefined") return;
  interactionsInstalled = true;

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest<HTMLElement>("button[data-usage-range]");
    if (!button) return;

    const page = button.closest<HTMLElement>('[data-role="page-usage"]');
    if (!page) return;

    const range = button.dataset.usageRange;
    if (range !== "30min" && range !== "1h" && range !== "1d") return;

    event.preventDefault();
    updateHeatmap(page, range);
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

/* ------------------------------------------------------------------ */
/* 小部件                                                              */
/* ------------------------------------------------------------------ */

function renderProfileSelector(data: UsageViewData, copy: UsageCopy): string {
  const profiles =
    data.profiles.length > 0
      ? data.profiles
      : [{ id: "usage-unknown", label: "—", detail: undefined }];
  const options = profiles
    .map(
      (profile) =>
        `<option value="${escapeHtml(profile.id)}"${profile.id === data.selectedProfileId ? " selected" : ""}>${escapeHtml(profile.label)}</option>`,
    )
    .join("");

  return `<label class="usage-profile">
    <span class="usage-profile-label">${escapeHtml(copy.profileLabel)}</span>
    <select class="usage-profile-select" data-usage-profile aria-label="${escapeHtml(copy.profileAria)}">${options}</select>
  </label>`;
}

function renderQuotaWindow(window: UsageQuotaWindow, copy: UsageCopy): string {
  const percent = normalizePercent(window.usedPercent);
  const meter =
    percent === null
      ? `<div class="usage-meter is-unknown" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuetext="${escapeHtml(copy.pending)}"><span class="usage-meter-fill"></span></div>`
      : `<progress class="usage-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-valuetext="${percent}%" value="${percent}" max="100">${percent}%</progress>`;

  return `<div class="usage-quota-window" data-usage-window="${escapeHtml(window.id)}">
    <div class="usage-window-head">
      <span class="usage-window-label">${escapeHtml(window.label)}</span>
      <span class="usage-window-value">${percent === null ? "—" : `${percent}%`}</span>
    </div>
    ${meter}
    <div class="usage-window-reset">${escapeHtml(copy.windowReset)} ${escapeHtml(formatReset(window.resetAt))}</div>
  </div>`;
}

function renderRangeButton(range: UsageRange, active: boolean, language: "zh" | "en"): string {
  return `<button type="button" class="usage-range-button${active ? " is-active" : ""}" data-usage-range="${range}" aria-pressed="${active}">${escapeHtml(USAGE_RANGE_META[range].label[language])}</button>`;
}

function renderLedgerStatus(ledger: UsageLedgerState, copy: UsageCopy): string {
  if (!ledger.lastSyncedAt) return copy.ledgerPending;
  const day = ledger.lastSyncedAt.slice(0, 10);
  const records = ledger.recordCount === null ? "" : ` · ${copy.ledgerRecords(ledger.recordCount)}`;
  return `${day}${records}`;
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

function normalizePercent(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function formatReset(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 16).replace("T", " ");
}

/** 演示强度：按区间、按位置确定性生成，不调用随机数。 */
function demoLevel(range: UsageRange, index: number): 0 | 1 | 2 | 3 | 4 {
  const noise = hash(index + (range === "30min" ? 11 : range === "1h" ? 29 : 47)) % 100;

  if (range === "1h") {
    const hour = index % 24;
    if (hour < 7 || hour > 22) return 0;
    if (noise < 18) return 0;
    if (noise < 44) return 1;
    if (noise < 70) return 2;
    if (noise < 88) return 3;
    return 4;
  }

  if (range === "30min") {
    const halfHour = index % 48;
    if (halfHour < 14 || halfHour > 45) return 0;
    if (noise < 22) return 0;
    if (noise < 50) return 1;
    if (noise < 74) return 2;
    if (noise < 91) return 3;
    return 4;
  }

  const weekday = index % 7;
  if (weekday === 5 || weekday === 6) return noise < 55 ? 0 : noise < 85 ? 1 : 2;
  if (noise < 12) return 0;
  if (noise < 38) return 1;
  if (noise < 65) return 2;
  if (noise < 87) return 3;
  return 4;
}

function hash(value: number): number {
  let x = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

installUsageInteractions();
installUsageStyles();
