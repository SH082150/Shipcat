/** 底部一体化账户按钮与账户菜单；动作统一由 app.ts 的事件委托处理。 */

import { avatarSlot, escapeHtml } from "./html.ts";
import { iconSvg } from "./icons.ts";
import type { ClientInfo } from "./events.ts";
import type { Translator } from "./i18n.ts";

export interface AccountMenuProps {
  readonly t: Translator;
  readonly menuOpen: boolean;
  readonly clientInfo: ClientInfo;
  /** 自定义头像 data URL；空串显示空占位。 */
  readonly avatar?: string;
}

export interface AccountButtonProps {
  readonly t: Translator;
  readonly menuOpen: boolean;
  readonly clientInfo: ClientInfo;
  readonly avatar?: string;
}

function displayName(props: AccountMenuProps | AccountButtonProps): string {
  const username = props.clientInfo.username?.trim();
  return username && username.length > 0 ? username : props.t.t("account.localUser");
}

function displayDetail(props: AccountMenuProps | AccountButtonProps): string {
  const hostname = props.clientInfo.hostname?.trim();
  return hostname && hostname.length > 0 ? hostname : props.t.t("account.localAccount");
}

export function renderAccountMenu(props: AccountMenuProps): string {
  if (!props.menuOpen) return "";

  const { t } = props;

  return `<div class="account-menu" id="account-menu" data-role="account-menu" role="menu" aria-label="${escapeHtml(t.t("account.menu"))}">
    <div class="account-menu-heading">
      ${avatarSlot("account-avatar account-menu-avatar", props.avatar)}
      <span class="account-menu-identity">
        <span class="account-name">${escapeHtml(displayName(props))}</span>
        <span class="account-detail">${escapeHtml(displayDetail(props))}</span>
      </span>
    </div>
    <div class="account-menu-body">
      <button
        type="button"
        class="menu-item"
        data-action="settings"
        data-section="general"
        data-source="account-menu"
        role="menuitem"
      >${iconSvg("settings", "menu-icon")}<span class="menu-label">${escapeHtml(t.t("account.settings"))}</span></button>
      <button
        type="button"
        class="menu-item"
        data-action="open-language"
        data-source="account-menu"
        role="menuitem"
        aria-haspopup="dialog"
      >${iconSvg("globe", "menu-icon")}<span class="menu-label">${escapeHtml(t.t("account.language"))}</span></button>
      <div class="menu-divider" role="separator"></div>
      <button
        type="button"
        class="menu-item"
        data-action="learn-more"
        data-section="client-info"
        data-source="account-menu"
        role="menuitem"
      >${iconSvg("info", "menu-icon")}<span class="menu-label">${escapeHtml(t.t("account.learnMore"))}</span>${iconSvg("chevron-right", "menu-external")}</button>
    </div>
  </div>`;
}

export function renderAccountButton(props: AccountButtonProps): string {
  const { t } = props;
  return `<button
    type="button"
    class="account-button"
    data-role="account-button"
    data-action="account"
    aria-haspopup="menu"
    aria-controls="account-menu"
    aria-expanded="${props.menuOpen}"
    aria-label="${escapeHtml(t.t("account.menu"))}"
    title="${escapeHtml(t.t("account.hint"))}"
  >
    ${avatarSlot("account-avatar", props.avatar)}
    <span class="account-meta">
      <span class="account-name">${escapeHtml(displayName(props))}</span>
      <span class="account-detail">${escapeHtml(displayDetail(props))}</span>
    </span>
    ${iconSvg("chevron-down", "account-chevron")}
  </button>`;
}
