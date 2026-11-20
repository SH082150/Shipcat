/** 页面共用骨架：标题区、按钮、空状态与说明列表。 */

import type { PageId } from "../state/navigation.ts";
import { escapeHtml, iconSlot } from "./html.ts";

export interface ActionButtonSpec {
  readonly label: string;
  readonly action: "settings" | "learn-more" | "navigate";
  readonly source: string;
  readonly section?: "general" | "privacy" | "usage" | "system" | "client-info";
  readonly page?: PageId;
  /** 与 page 一起出现时打开详情路由。 */
  readonly id?: string;
  readonly variant?: "primary" | "secondary" | "text" | "ghost";
}

export function renderActionButton(spec: ActionButtonSpec): string {
  const variant = spec.variant ?? "secondary";
  const attributes =
    spec.action === "navigate"
      ? `data-action="navigate" data-page="${spec.page ?? "overview"}"${spec.id ? ` data-id="${escapeHtml(spec.id)}"` : ""} data-source="${escapeHtml(spec.source)}"`
      : `data-action="${spec.action}" data-section="${spec.section ?? (spec.action === "learn-more" ? "client-info" : "general")}" data-source="${escapeHtml(spec.source)}"`;
  return `<button type="button" class="button button--${variant}" ${attributes}>${escapeHtml(spec.label)}</button>`;
}

export interface PageHeaderProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly actions?: string;
}

export function renderPageHeader(props: PageHeaderProps): string {
  return `<header class="page-header">
    <div class="page-heading">
      <span class="page-eyebrow">${escapeHtml(props.eyebrow)}</span>
      <h1>${escapeHtml(props.title)}</h1>
      <p class="page-description">${escapeHtml(props.description)}</p>
    </div>
    ${props.actions ? `<div class="page-actions">${props.actions}</div>` : ""}
  </header>`;
}

export interface EmptyStateProps {
  readonly title: string;
  readonly body: string;
  readonly actions: string;
  readonly iconClass?: string;
}

export function renderEmptyState(props: EmptyStateProps): string {
  return `<section class="empty-state" data-role="empty-state">
    <div class="empty-illustration" aria-hidden="true">${iconSlot(props.iconClass ?? "empty-icon")}</div>
    <h2>${escapeHtml(props.title)}</h2>
    <p>${escapeHtml(props.body)}</p>
    <div class="empty-actions">${props.actions}</div>
  </section>`;
}

export function renderInfoList(items: readonly string[]): string {
  return `<ul class="info-list">${items
    .map(
      (item) =>
        `<li class="info-row">${iconSlot("info-icon")}<span>${escapeHtml(item)}</span></li>`,
    )
    .join("")}</ul>`;
}
