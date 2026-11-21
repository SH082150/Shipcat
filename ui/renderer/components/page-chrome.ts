/** 页面共用骨架：标题区。 */

import { escapeHtml } from "./html.ts";

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
