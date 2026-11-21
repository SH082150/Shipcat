/**
 * 侧边栏结构：四条主导航、底部账户与独立齿轮。
 *
 * 侧栏开关按钮不属于侧栏——它位于窗口标题栏，由 app.ts 放进 drag region，
 * 这样红绿灯、按钮与侧栏面板的层级关系保持稳定。
 *
 * 底部 footer 是 aside 的直接子元素，不在 .sidebar-inner 的内边距里，
 * 所以那条上分割线能横贯侧栏、接到窗口左右边缘。
 */

import type { PageId } from "../state/navigation.ts";
import { escapeHtml } from "./html.ts";
import { iconSvg } from "./icons.ts";
import type { IconName } from "./icons.ts";
import { renderAccountButton, renderAccountMenu } from "./account-menu.ts";
import type { ClientInfo } from "./events.ts";
import type { Language, Translator } from "./i18n.ts";
import { NAV_ITEMS } from "./navigation.ts";

export interface SidebarProps {
  readonly t: Translator;
  readonly page: PageId;
  readonly language: Language;
  readonly menuOpen: boolean;
  readonly clientInfo: ClientInfo;
  /** 自定义头像 data URL；空串显示空白。 */
  readonly avatar?: string;
}

const NAV_ICONS: Record<PageId, IconName> = {
  overview: "overview",
  providers: "providers",
  profiles: "profiles",
  usage: "usage",
};

export function renderSidebar(props: SidebarProps): string {
  const { t, page, menuOpen, clientInfo, avatar } = props;

  const nav = NAV_ITEMS.map((item) => {
    const active = item.id === page;
    return `<button
      type="button"
      class="nav-item${active ? " is-active" : ""}"
      data-action="navigate"
      data-page="${item.id}"
      data-source="sidebar"
      ${active ? 'aria-current="page"' : ""}
      title="${escapeHtml(t.t(item.hintKey))}"
    >${iconSvg(NAV_ICONS[item.id], "nav-icon")}<span class="nav-label">${escapeHtml(t.t(item.labelKey))}</span></button>`;
  }).join("");

  return `<aside class="sidebar" id="app-sidebar" data-role="sidebar" data-current-page="${page}" aria-label="${escapeHtml(t.t("sidebar.label"))}">
  <div class="sidebar-inner">
    <div class="sidebar-body" data-role="sidebar-body">
      <nav class="sidebar-nav" data-role="sidebar-nav" aria-label="${escapeHtml(t.t("nav.label"))}">
        ${nav}
      </nav>
    </div>
  </div>

  <footer class="sidebar-footer" data-role="sidebar-footer" aria-label="${escapeHtml(t.t("sidebar.footer"))}">
    <div class="account-wrap">
      ${renderAccountMenu({ t, menuOpen, clientInfo, avatar })}
      ${renderAccountButton({ t, menuOpen, clientInfo, avatar })}
    </div>
    <button
      type="button"
      class="icon-button sidebar-gear"
      data-action="settings"
      data-section="general"
      data-source="sidebar-gear"
      aria-label="${escapeHtml(t.t("sidebar.gear"))}"
      title="${escapeHtml(t.t("sidebar.gear"))}"
    >${iconSvg("settings", "gear-icon")}</button>
  </footer>
</aside>`;
}
