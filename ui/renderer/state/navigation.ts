/**
 * 导航页状态：UI 只有四个顶层页面，非法输入一律回落到 overview。
 *
 * 顶层页面之外，providers 与 profiles 允许 `#<page>/<detailId>` 详情路由。
 * 这里只做纯解析，不触碰 history 或 DOM；app.ts 负责把 Route 写回 hash。
 */

export const PAGE_IDS = ["overview", "providers", "profiles", "usage"] as const;

export type PageId = (typeof PAGE_IDS)[number];

export const DEFAULT_PAGE: PageId = "overview";

export const DETAIL_PAGES = ["providers", "profiles"] as const;

export type DetailPageId = (typeof DETAIL_PAGES)[number];

export const MAX_DETAIL_ID_LENGTH = 128;

export interface Route {
  readonly page: PageId;
  /** 详情页 id；列表页为 null。 */
  readonly detailId: string | null;
}

export function isPageId(value: unknown): value is PageId {
  return typeof value === "string" && (PAGE_IDS as readonly string[]).includes(value);
}

export function isDetailPage(value: unknown): value is DetailPageId {
  return (
    typeof value === "string" && (DETAIL_PAGES as readonly string[]).includes(value)
  );
}

/** 把任意输入（hash、data-page、持久化值）归一为合法页，默认 overview。 */
export function navigate(target: unknown): PageId {
  return isPageId(target) ? target : DEFAULT_PAGE;
}

function decodeDetailId(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function normalizeDetailId(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_DETAIL_ID_LENGTH) return null;
  if (trimmed === "." || trimmed === "..") return null;
  if (/[\\/]/.test(trimmed)) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

/**
 * 解析 `#providers/openai`、`providers/openai` 或 `#providers`。
 * 只有一层详情段被接受；多余斜杠、空白 id、控制字符都退回列表页。
 */
export function parseRoute(input: unknown): Route {
  const raw = typeof input === "string" ? input.trim().replace(/^#+/, "") : "";
  const [pageSegment = "", ...rest] = raw.split("/");
  const page = navigate(pageSegment);

  if (!isDetailPage(page) || rest.length !== 1) {
    return { page, detailId: null };
  }

  const decoded = decodeDetailId(rest[0] ?? "");
  const detailId = decoded === null ? null : normalizeDetailId(decoded);
  return { page, detailId };
}

/** Route → hash；非法/空详情 id 自动退回列表 hash。 */
export function routeHash(route: Route): string {
  const page = navigate(route.page);
  if (!isDetailPage(page) || !route.detailId) return `#${page}`;
  const detailId = normalizeDetailId(route.detailId);
  return detailId === null ? `#${page}` : `#${page}/${encodeURIComponent(detailId)}`;
}

export function sameRoute(a: Route | null, b: Route | null): boolean {
  if (a === null || b === null) return a === b;
  return a.page === b.page && a.detailId === b.detailId;
}
