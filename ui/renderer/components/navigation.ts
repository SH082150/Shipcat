/** 五个顶层导航项：页面 id 与文案键的唯一来源。 */

import type { PageId } from "../state/navigation.ts";
import type { MessageKey } from "./i18n.ts";

export interface NavItem {
  readonly id: PageId;
  readonly labelKey: MessageKey;
  readonly hintKey: MessageKey;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: "overview",
    labelKey: "nav.overview",
    hintKey: "nav.overviewHint",
  },
  {
    id: "providers",
    labelKey: "nav.providers",
    hintKey: "nav.providersHint",
  },
  {
    id: "profiles",
    labelKey: "nav.profiles",
    hintKey: "nav.profilesHint",
  },
  {
    id: "usage",
    labelKey: "nav.usage",
    hintKey: "nav.usageHint",
  },
  {
    id: "monitor",
    labelKey: "nav.monitor",
    hintKey: "nav.monitorHint",
  },
];

export const PAGE_TITLE_KEYS: Record<PageId, MessageKey> = {
  overview: "overview.title",
  providers: "providers.title",
  profiles: "profiles.title",
  usage: "usage.title",
  monitor: "monitor.title",
};

