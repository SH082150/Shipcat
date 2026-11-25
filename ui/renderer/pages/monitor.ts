/**
 * Monitor 页：逐行展示 Monitor 数据库里的用量记录。
 *
 * 页面只输出字符串骨架；数据、分页、搜索由 monitor-view.ts 在挂载后接管。
 */

import { escapeHtml } from "../components/html.ts";
import { iconSvg } from "../components/icons.ts";
import type { PageContext } from "./types.ts";

const SURFACES = [
  ["all", "monitor.tab.all"],
  ["chat", "Chat"],
  ["cowork", "Cowork"],
  ["code", "Code"],
] as const;

export function renderMonitorPage(context: PageContext): string {
  const { t } = context;
  const tabs = SURFACES.map(([value, label]) => {
    const text = label.startsWith("monitor.") ? t.t(label as never) : label;
    const pressed = value === "all" ? "true" : "false";
    return `<button type="button" data-monitor-tab="${value}" aria-pressed="${pressed}">${escapeHtml(text)}</button>`;
  }).join("");

  return `<div class="page page--monitor">
    <header class="page-header">
      <div class="page-heading">
        <span class="page-eyebrow">${escapeHtml(t.t("monitor.eyebrow"))}</span>
        <h1>${escapeHtml(t.t("monitor.title"))}</h1>
        <p>${escapeHtml(t.t("monitor.description"))}</p>
      </div>
      <div class="page-actions monitor-actions">
        <div class="monitor-tools">
          <div class="monitor-search" data-monitor-search data-open="false">
            <button type="button" class="monitor-square" data-monitor-action="search-open" aria-label="${escapeHtml(t.t("monitor.search.aria"))}">${iconSvg("search", "monitor-icon")}</button>
            <div class="monitor-search-field">
              ${iconSvg("search", "monitor-search-icon")}
              <input type="search" data-monitor-query aria-label="${escapeHtml(t.t("monitor.search.aria"))}" placeholder="${escapeHtml(t.t("monitor.search.placeholder"))}" autocomplete="off" spellcheck="false" />
              <button type="button" class="monitor-search-close" data-monitor-action="search-close" aria-label="${escapeHtml(t.t("monitor.search.close"))}">${iconSvg("close", "monitor-icon")}</button>
            </div>
          </div>
          <button type="button" class="monitor-square" data-monitor-action="refresh" aria-label="${escapeHtml(t.t("monitor.refresh"))}" title="${escapeHtml(t.t("monitor.refresh"))}">${iconSvg("refresh", "monitor-icon")}</button>
        </div>
        <nav class="monitor-tabs" aria-label="${escapeHtml(t.t("monitor.tabs.aria"))}">${tabs}</nav>
      </div>
    </header>

    <section class="monitor-block">
      <div class="monitor-summary">
      <article class="monitor-card">
        <span>${escapeHtml(t.t("monitor.summary.cost"))}</span>
        <strong data-monitor-total-cost>—</strong>
        <small>${escapeHtml(t.t("monitor.summary.costHint"))}</small>
      </article>
      <article class="monitor-card">
        <span>${escapeHtml(t.t("monitor.summary.tokens"))}</span>
        <strong data-monitor-total-tokens>0</strong>
        <small><span data-monitor-count>0</span> ${escapeHtml(t.t("monitor.summary.records"))}</small>
      </article>
      <article class="monitor-card">
        <span>${escapeHtml(t.t("monitor.summary.hitRate"))}</span>
        <strong data-monitor-hit>0%</strong>
        <small>${escapeHtml(t.t("monitor.summary.hitRateHint"))}</small>
      </article>
      </div>
    </section>

    <section class="monitor-block monitor-block--events" aria-label="${escapeHtml(t.t("monitor.list.aria"))}">
      <div class="monitor-events" aria-label="${escapeHtml(t.t("monitor.list.aria"))}">
      <div class="monitor-table">
      <div class="monitor-head">
        <span class="monitor-col--time">${escapeHtml(t.t("monitor.col.time"))}</span>
        <span>${escapeHtml(t.t("monitor.col.type"))}</span>
        <span>${escapeHtml(t.t("monitor.col.surface"))}</span>
        <span>${escapeHtml(t.t("monitor.col.providers"))}</span>
        <span>${escapeHtml(t.t("monitor.col.models"))}</span>
        <span>${escapeHtml(t.t("monitor.col.input"))}</span>
        <span>${escapeHtml(t.t("monitor.col.cacheRead"))}</span>
        <span>${escapeHtml(t.t("monitor.col.output"))}</span>
        <span>${escapeHtml(t.t("monitor.col.tools"))}</span>
        <span>${escapeHtml(t.t("monitor.col.hitRate"))}</span>
        <span>${escapeHtml(t.t("monitor.col.status"))}</span>
      </div>
      <div class="monitor-rows" data-monitor-rows role="rowgroup"></div>
      </div>
      <div class="monitor-empty" data-monitor-empty hidden>
        <span aria-hidden="true">∅</span>
        <h2 data-monitor-empty-title>${escapeHtml(t.t("monitor.empty.title"))}</h2>
        <p data-monitor-empty-body>${escapeHtml(t.t("monitor.empty.body"))}</p>
      </div>
      <div class="monitor-foot">
        <div class="monitor-pager">
          <button type="button" data-monitor-action="prev" aria-label="${escapeHtml(t.t("monitor.prev"))}">${iconSvg("chevron-right", "monitor-pager-icon monitor-pager-icon--prev")}</button>
          <button type="button" class="monitor-page-display" data-monitor-action="page-edit" data-monitor-page aria-label="${escapeHtml(t.t("monitor.page.jump"))}">1 / 1</button>
          <span class="monitor-page-entry" data-monitor-page-entry hidden>
            <input type="text" inputmode="numeric" data-monitor-page-input aria-label="${escapeHtml(t.t("monitor.page.input"))}" autocomplete="off" spellcheck="false" />
            <span>/ <span data-monitor-page-total>1</span></span>
          </span>
          <button type="button" data-monitor-action="next" aria-label="${escapeHtml(t.t("monitor.next"))}">${iconSvg("chevron-right", "monitor-pager-icon")}</button>
        </div>
      </div>
      </div>
    </section>

    <dialog class="monitor-dialog" data-monitor-dialog tabindex="-1" aria-labelledby="monitor-dialog-title">
      <div class="monitor-dialog-head">
        <div>
          <h2 id="monitor-dialog-title" data-monitor-dialog-title>${escapeHtml(t.t("monitor.detail.title"))}</h2>
          <p data-monitor-dialog-sub></p>
        </div>
        <button type="button" class="monitor-square" data-monitor-action="dialog-close" aria-label="${escapeHtml(t.t("monitor.dialog.close"))}">${iconSvg("close", "monitor-icon")}</button>
      </div>
      <div class="monitor-dialog-body">
        <dl class="monitor-detail" data-monitor-dialog-fields></dl>
        <h3 class="monitor-raw-heading">${escapeHtml(t.t("monitor.detail.raw"))}</h3>
        <pre class="monitor-raw" data-monitor-dialog-raw></pre>
      </div>
    </dialog>
  </div>`;
}
