/** 页面渲染上下文：页面只拿文案、语言与最小客户端信息。 */

import type { ClientInfo } from "../components/events.ts";
import type { Language, Translator } from "../components/i18n.ts";
import type { PageId } from "../state/navigation.ts";

/** 概览页展示模式：standard 隐藏网关栏，advanced 显示。 */
export type OverviewMode = "standard" | "advanced";

/**
 * 建议项的跳转目标。与 app.ts 的事件委托保持一致：
 * navigate 走 data-page，settings 走 data-section，不直接依赖设置层。
 */
export type OverviewHintTarget =
  | { readonly action: "navigate"; readonly page: PageId }
  | { readonly action: "settings"; readonly section?: "general" | "client-info" };

/** 一条可扩展的“建议/智能提示”，渲染成细分割线列表中的一行。 */
export interface OverviewHint {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly target: OverviewHintTarget;
}

/**
 * 概览页可注入内容。所有字段都可省略，页面回落到本地中英文案与空态：
 * - greeting 省略时按语言、当前时间和 clientInfo.username 生成
 *   “Good night, alice”/“晚上好，小明”；字符串里的 {username} 会替换成用户名；
 * - activeProfile 为 null/空串时显示“无激活配置”空态；
 * - mode 默认 standard；
 * - hints 省略时使用内置两条建议，传 [] 可完全隐藏。
 */
export interface OverviewContent {
  readonly greeting?: string;
  readonly activeProfile?: string | null;
  readonly activeProfileId?: string;
  readonly mode?: OverviewMode;
  /** 网关最近一次错误；有值时显示通知条。 */
  readonly gatewayError?: string;
  /** advanced 模式下本地网关是否已在运行；缺省 false。 */
  readonly gatewayEnabled?: boolean;
  readonly hints?: readonly OverviewHint[];
  /** 与 Claude Desktop 的配置不一致、需要检查同步的档案数。 */
  readonly syncPending?: number;
}

export interface PageContext {
  readonly t: Translator;
  readonly language: Language;
  readonly clientInfo: ClientInfo;
  readonly overview?: OverviewContent;
}
