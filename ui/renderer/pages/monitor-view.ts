/**
 * Monitor 页行为：主进程分页查询、实时刷新、搜索、模块分栏与详情弹窗。
 *
 * 过滤、汇总和分页都在主进程完成，渲染层只保留当前页的记录。
 * 时间按用量设置里的时区显示，分页行数随列表可用高度调整。
 */

import { monitorApi, usageApi } from "../api/core.ts";
import { createTranslator } from "../components/i18n.ts";
import type { Language, Translator } from "../components/i18n.ts";
import type { MonitorRecordDto, MonitorTotalsDto } from "../../shared/ipc.ts";

const PAGE_SIZE = 10;
const LIVE_REFRESH_MS = 300;

interface MonitorViewState {
  records: MonitorRecordDto[];
  total: number;
  totals: MonitorTotalsDto;
  surface: string;
  query: string;
  page: number;
  timeZone: string;
}

const EMPTY_TOTALS: MonitorTotalsDto = {
  tokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheableTokens: 0,
};

const TYPE_LABELS: Record<Language, Record<string, string>> = {
  zh: { turn: "回合", title: "标题", connection_probe: "探测", preview_agent_detection: "预览" },
  en: { turn: "Turn", title: "Title", connection_probe: "Probe", preview_agent_detection: "Preview" },
};

const SURFACE_LABELS: Record<string, string> = { code: "Code", cowork: "Cowork", chat: "Chat" };

let state: MonitorViewState | null = null;
let unsubscribe: (() => void) | null = null;
let language: Language = "zh";
let t: Translator = createTranslator("zh");
let liveTimer: number | null = null;
let searchTimer: number | null = null;
let unsubscribeUsage: (() => void) | null = null;
let requestSeq = 0;

function systemTimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function partsOf(ts: number, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(ts)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return parts;
}

function formatTime(ts: number, timeZone: string): string {
  const value = partsOf(ts, timeZone);
  return `${value.hour}:${value.minute}:${value.second}`;
}

function formatFull(ts: number, timeZone: string): string {
  const value = partsOf(ts, timeZone);
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}:${value.second}`;
}

function totalUsage(record: MonitorRecordDto) {
  const total = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  for (const models of Object.values(record.provider)) {
    for (const usage of Object.values(models)) {
      total.inputTokens += usage.inputTokens;
      total.outputTokens += usage.outputTokens;
      total.cacheReadTokens += usage.cacheReadTokens;
      total.cacheWriteTokens += usage.cacheWriteTokens;
    }
  }
  return total;
}

function providerLabel(record: MonitorRecordDto, id: string): string {
  return record.providerNames?.[id] ?? id;
}

function providerNames(record: MonitorRecordDto): string[] {
  return Object.keys(record.provider).map((id) => providerLabel(record, id));
}

function modelNames(record: MonitorRecordDto): string[] {
  const names = new Set<string>();
  for (const models of Object.values(record.provider)) {
    for (const model of Object.keys(models)) names.add(model);
  }
  return [...names];
}

function hitRate(record: MonitorRecordDto): number {
  const total = totalUsage(record);
  const cacheable = total.inputTokens + total.cacheReadTokens + total.cacheWriteTokens;
  return cacheable === 0 ? 0 : (total.cacheReadTokens / cacheable) * 100;
}

function compactTokens(value: number): string {
  const units: ReadonlyArray<readonly [number, string]> = [
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1000, "K"],
  ];
  for (const [size, suffix] of units) {
    if (value < size) continue;
    const scaled = value / size;
    const digits = scaled < 100 && !Number.isInteger(scaled) ? 1 : 0;
    return `${scaled.toFixed(digits)}${suffix}`;
  }
  return String(value);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function cell(className: string, text: string, title?: string): HTMLElement {
  const node = el("span", className, text);
  node.setAttribute("role", "cell");
  if (title !== undefined && title.length > 0) node.title = title;
  return node;
}

function row(record: MonitorRecordDto): HTMLElement {
  if (state === null) return el("div");
  const timeZone = state.timeZone;
  const item = el("div", `monitor-row${record.isError ? " is-error" : ""}`);
  item.dataset.surface = record.surface;
  item.dataset.eventId = record.eventId;
  item.setAttribute("role", "row");
  item.tabIndex = 0;

  const total = totalUsage(record);
  const providers = providerNames(record);
  const models = modelNames(record);
  const toolCount = Object.values(record.tools).reduce((sum, n) => sum + n, 0);

  const cells: HTMLElement[] = [
    cell("monitor-cell monitor-cell--time", formatTime(record.ts, timeZone), formatFull(record.ts, timeZone)),
    cell("monitor-cell", TYPE_LABELS[language][record.origin] ?? "—"),
    cell("monitor-cell", SURFACE_LABELS[record.surface] ?? record.surface),
    cell("monitor-cell", String(providers.length), providers.join(", ")),
    cell("monitor-cell", String(models.length), models.join(", ")),
    cell("monitor-cell", compactTokens(total.inputTokens)),
    cell("monitor-cell", compactTokens(total.cacheReadTokens)),
    cell("monitor-cell", compactTokens(total.outputTokens)),
    cell("monitor-cell", String(toolCount)),
    cell("monitor-cell", `${hitRate(record).toFixed(1)}%`),
    cell(
      `monitor-cell monitor-status${record.isError ? " is-error" : ""}`,
      record.isError ? t.t("monitor.status.error") : t.t("monitor.status.ok"),
    ),
  ];
  item.append(...cells);

  item.addEventListener("click", () => openDialog(record));
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDialog(record);
    }
  });
  return item;
}

function openDialog(record: MonitorRecordDto): void {
  if (state === null) return;
  const timeZone = state.timeZone;
  const root = document.querySelector<HTMLElement>(".page--monitor");
  if (root === null) return;
  const dialog = root.querySelector<HTMLDialogElement>("[data-monitor-dialog]");
  const title = root.querySelector<HTMLElement>("[data-monitor-dialog-title]");
  const sub = root.querySelector<HTMLElement>("[data-monitor-dialog-sub]");
  const fields = root.querySelector<HTMLElement>("[data-monitor-dialog-fields]");
  const raw = root.querySelector<HTMLElement>("[data-monitor-dialog-raw]");
  if (dialog === null || title === null || sub === null || fields === null || raw === null) return;

  const total = totalUsage(record);
  const routes = Object.entries(record.provider).flatMap(([id, models]) =>
    Object.keys(models).map((model) => `${providerLabel(record, id)} → ${model}`),
  );
  const tools = Object.entries(record.tools).map(([name, count]) => `${name} ×${count}`);

  title.textContent = record.eventId.slice(0, 12);
  sub.textContent = `${formatFull(record.ts, timeZone)} · ${SURFACE_LABELS[record.surface] ?? record.surface}`;
  const rows: Array<[string, string]> = [
    [t.t("monitor.detail.time"), formatFull(record.ts, timeZone)],
    [t.t("monitor.detail.surface"), SURFACE_LABELS[record.surface] ?? record.surface],
    [t.t("monitor.detail.origin"), TYPE_LABELS[language][record.origin] ?? record.origin],
    [
      t.t("monitor.detail.status"),
      record.isError ? t.t("monitor.status.error") : t.t("monitor.status.ok"),
    ],
    [t.t("monitor.detail.session"), record.sessionId ?? t.t("monitor.detail.sessionEmpty")],
    [t.t("monitor.detail.event"), record.eventId],
    [t.t("monitor.detail.routes"), routes.join("\n") || t.t("monitor.detail.none")],
    [t.t("monitor.detail.input"), String(total.inputTokens)],
    [t.t("monitor.detail.output"), String(total.outputTokens)],
    [t.t("monitor.detail.cacheRead"), String(total.cacheReadTokens)],
    [t.t("monitor.detail.cacheWrite"), String(total.cacheWriteTokens)],
    [t.t("monitor.detail.hitRate"), `${hitRate(record).toFixed(1)}%`],
    [t.t("monitor.detail.tools"), tools.join(t.language === "zh" ? "，" : ", ") || t.t("monitor.detail.none")],
  ];
  fields.replaceChildren(
    ...rows.flatMap(([label, value]) => [el("dt", "", label), el("dd", "", value)]),
  );
  if (record.rawLine.length === 0) {
    raw.textContent = t.t("monitor.detail.rawEmpty");
  } else {
    try {
      raw.textContent = JSON.stringify(JSON.parse(record.rawLine), null, 2);
    } catch {
      raw.textContent = record.rawLine;
    }
  }
  if (!dialog.open) {
    dialog.showModal();
    dialog.focus();
  }
}

function totalPages(): number {
  if (state === null) return 1;
  return Math.max(1, Math.ceil(state.total / PAGE_SIZE));
}

function render(): void {
  const root = document.querySelector<HTMLElement>(".page--monitor");
  if (root === null || state === null) return;

  const container = root.querySelector<HTMLElement>("[data-monitor-rows]");
  if (container !== null) {
    container.replaceChildren(...state.records.map(row));
  }

  const empty = root.querySelector<HTMLElement>("[data-monitor-empty]");
  if (empty !== null) {
    empty.hidden = state.total > 0;
    const filtered = state.query.length > 0 || state.surface !== "all";
    const emptyTitle = root.querySelector<HTMLElement>("[data-monitor-empty-title]");
    const emptyBody = root.querySelector<HTMLElement>("[data-monitor-empty-body]");
    if (emptyTitle !== null) {
      emptyTitle.textContent = t.t(
        filtered ? "monitor.empty.filteredTitle" : "monitor.empty.title",
      );
    }
    if (emptyBody !== null) {
      emptyBody.textContent = t.t(filtered ? "monitor.empty.filteredBody" : "monitor.empty.body");
    }
  }

  const count = root.querySelector<HTMLElement>("[data-monitor-count]");
  if (count !== null) count.textContent = String(state.total);

  const tokenNode = root.querySelector<HTMLElement>("[data-monitor-total-tokens]");
  if (tokenNode !== null) tokenNode.textContent = compactTokens(state.totals.tokens);
  const hitNode = root.querySelector<HTMLElement>("[data-monitor-hit]");
  if (hitNode !== null) {
    const rate =
      state.totals.cacheableTokens === 0
        ? 0
        : (state.totals.cacheReadTokens / state.totals.cacheableTokens) * 100;
    hitNode.textContent = `${rate.toFixed(1)}%`;
  }

  const pages = totalPages();
  const pager = root.querySelector<HTMLElement>("[data-monitor-page]");
  if (pager !== null) pager.textContent = `${state.page} / ${pages}`;
  const totalNode = root.querySelector<HTMLElement>("[data-monitor-page-total]");
  if (totalNode !== null) totalNode.textContent = String(pages);
  const pageInput = root.querySelector<HTMLInputElement>("[data-monitor-page-input]");
  if (pageInput !== null && document.activeElement !== pageInput) {
    pageInput.value = String(state.page);
  }
  const prev = root.querySelector<HTMLButtonElement>('[data-monitor-action="prev"]');
  if (prev !== null) prev.disabled = state.page <= 1;
  const next = root.querySelector<HTMLButtonElement>('[data-monitor-action="next"]');
  if (next !== null) next.disabled = state.page >= pages;
}

function setPageEditing(root: HTMLElement, editing: boolean): void {
  const display = root.querySelector<HTMLElement>("[data-monitor-page]");
  const entry = root.querySelector<HTMLElement>("[data-monitor-page-entry]");
  const input = root.querySelector<HTMLInputElement>("[data-monitor-page-input]");
  if (display === null || entry === null || input === null) return;
  display.hidden = editing;
  entry.hidden = !editing;
  if (editing) {
    input.value = String(state?.page ?? 1);
    input.focus();
    input.select();
  }
}

function commitPage(root: HTMLElement): void {
  const entry = root.querySelector<HTMLElement>("[data-monitor-page-entry]");
  const input = root.querySelector<HTMLInputElement>("[data-monitor-page-input]");
  if (state === null || entry === null || input === null || entry.hidden) return;
  const parsed = Number.parseInt(input.value, 10);
  if (Number.isFinite(parsed)) state.page = Math.min(Math.max(1, parsed), totalPages());
  setPageEditing(root, false);
  void fetchPage();
}

async function fetchPage(): Promise<void> {
  if (state === null) return;
  const seq = ++requestSeq;
  try {
    const page = await monitorApi.query({
      surface: state.surface,
      query: state.query,
      offset: (state.page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    });
    if (state === null || seq !== requestSeq) return;
    const pages = Math.max(1, Math.ceil(page.total / PAGE_SIZE));
    if (state.page > pages) {
      state.page = pages;
      void fetchPage();
      return;
    }
    state.records = [...page.records];
    state.total = page.total;
    state.totals = page.totals;
    render();
  } catch (error) {
    console.error("Monitor query failed:", error);
  }
}

function scheduleLiveRefresh(): void {
  if (liveTimer !== null) return;
  liveTimer = window.setTimeout(() => {
    liveTimer = null;
    void fetchPage();
  }, LIVE_REFRESH_MS);
}

export function mountMonitorView(root: HTMLElement, lang: Language): void {
  unmountMonitorView();
  language = lang;
  t = createTranslator(lang);
  state = {
    records: [],
    total: 0,
    totals: EMPTY_TOTALS,
    surface: "all",
    query: "",
    page: 1,
    timeZone: systemTimeZone(),
  };

  const pageRoot = root.querySelector<HTMLElement>(".page--monitor");
  if (pageRoot === null || state === null) return;

  pageRoot.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>("[data-monitor-action]")?.dataset.monitorAction;
    const tab = target.closest<HTMLElement>("[data-monitor-tab]")?.dataset.monitorTab;
    if (tab !== undefined && state !== null) {
      if (state.surface === tab) return;
      state.surface = tab;
      state.page = 1;
      for (const button of pageRoot.querySelectorAll<HTMLElement>("[data-monitor-tab]")) {
        button.setAttribute("aria-pressed", String(button.dataset.monitorTab === tab));
      }
      void fetchPage();
      return;
    }
    if (action === "prev" && state !== null) {
      state.page = Math.max(1, state.page - 1);
      void fetchPage();
    } else if (action === "next" && state !== null) {
      state.page = Math.min(totalPages(), state.page + 1);
      void fetchPage();
    } else if (action === "search-open") {
      const search = pageRoot.querySelector<HTMLElement>("[data-monitor-search]");
      if (search !== null) search.dataset.open = "true";
      pageRoot.querySelector<HTMLInputElement>("[data-monitor-query]")?.focus();
    } else if (action === "search-close" && state !== null) {
      const search = pageRoot.querySelector<HTMLElement>("[data-monitor-search]");
      if (search !== null) search.dataset.open = "false";
      const input = pageRoot.querySelector<HTMLInputElement>("[data-monitor-query]");
      if (input !== null) input.value = "";
      if (searchTimer !== null) {
        window.clearTimeout(searchTimer);
        searchTimer = null;
      }
      state.query = "";
      state.page = 1;
      void fetchPage();
    } else if (action === "refresh") {
      void fetchPage();
    } else if (action === "page-edit" && state !== null) {
      setPageEditing(pageRoot, true);
    } else if (action === "dialog-close") {
      pageRoot.querySelector<HTMLDialogElement>("[data-monitor-dialog]")?.close();
    }
  });

  const pageInput = pageRoot.querySelector<HTMLInputElement>("[data-monitor-page-input]");
  pageInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitPage(pageRoot);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setPageEditing(pageRoot, false);
      pageRoot.querySelector<HTMLElement>("[data-monitor-page]")?.focus();
    }
  });
  pageInput?.addEventListener("blur", () => commitPage(pageRoot));

  pageRoot.querySelector<HTMLInputElement>("[data-monitor-query]")?.addEventListener("input", (event) => {
    if (state === null) return;
    const value = (event.target as HTMLInputElement).value.trim().toLowerCase();
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      searchTimer = null;
      if (state === null) return;
      state.query = value;
      state.page = 1;
      void fetchPage();
    }, 180);
  });

  const dialog = pageRoot.querySelector<HTMLDialogElement>("[data-monitor-dialog]");
  dialog?.addEventListener("click", (event) => {
    const rect = dialog.getBoundingClientRect();
    const mouse = event as MouseEvent;
    if (
      mouse.clientX < rect.left ||
      mouse.clientX > rect.right ||
      mouse.clientY < rect.top ||
      mouse.clientY > rect.bottom
    ) {
      dialog.close();
    }
  });

  unsubscribe = monitorApi.onRecord(() => scheduleLiveRefresh());
  unsubscribeUsage = usageApi.onChanged(() => {
    void loadTimeZone();
  });

  void loadTimeZone();
  void fetchPage();
}

async function loadTimeZone(): Promise<void> {
  try {
    const config = await usageApi.getConfig();
    if (state === null || state.timeZone === config.timezone) return;
    state.timeZone = config.timezone;
    render();
  } catch (error) {
    console.error("Monitor timezone load failed:", error);
  }
}

export function unmountMonitorView(): void {
  unsubscribe?.();
  unsubscribe = null;
  unsubscribeUsage?.();
  unsubscribeUsage = null;
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer);
    searchTimer = null;
  }
  if (liveTimer !== null) {
    window.clearTimeout(liveTimer);
    liveTimer = null;
  }
  requestSeq += 1;
  state = null;
}
