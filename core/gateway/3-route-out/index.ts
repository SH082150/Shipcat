/**
 * 3-route-out — 替换去程：旅程的决策中心，"假名→真身"翻译 + 出站报文组装。
 *
 * 请求体只改 `model` 一个字段，其余逐字节不动；托管头由本层重建或丢弃，
 * 其余 anthropic-* / x-claude-code-* 头原样透传。查无路由 404，供应商不
 * 健全 502（不向上游发任何字节）。运行期只读路由表，零文件 IO。
 */

import { GatewayError } from "../errors/index.ts";
import type { Provider } from "../../types.ts";

/** 组装完成的上游请求描述，交给 4-send 发出。 */
export interface UpstreamPlan {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}

/** 一条路由的目标：假名 → 供应商连接信息 + 上游真身模型。 */
export interface RouteTarget {
  readonly providerName: string;
  readonly baseUrl: string;
  readonly authScheme: "x-api-key" | "bearer";
  readonly apiKey: string;
  readonly upstreamModel: string;
}

/** 路由表：假名 → 目标。构建于启动期，运行期只读。 */
export type RouteTable = ReadonlyMap<string, RouteTarget>;

/** buildRoutes 的模型条目输入（sidecar advanced 的 inferenceModels 精简形）。 */
export interface RouteEntry {
  readonly name: string;
  readonly provider: string;
  readonly upstreamModel: string;
}

/** 请求期输入：1-receive 的已读请求体。 */
export interface RoutableMessage {
  readonly body: Buffer;
}

/** Desktop 原始请求头（node:http 形状，值可能为数组）。 */
export type IncomingHeaders = Record<string, string | string[] | undefined>;

export type MessagesEndpoint = "/v1/messages" | "/v1/messages/count_tokens";

/** 托管头：构建上游请求时不透传、由本层按规则重建或丢弃。 */
const MANAGED_HEADERS = new Set([
  "host",
  "authorization",
  "x-api-key",
  "content-length",
  "content-type",
  "accept",
  "accept-encoding",
  "anthropic-version",
  "anthropic-beta",
]);

/** hop-by-hop 头：请求与响应方向都不透传。 */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

/**
 * 启动期构建路由表。resolveProvider 由调用方（0-server）注入，把条目里的
 * 供应商 UUID 解析成供应商文件内容；查不到或 apiKey 为空的条目跳过，并
 * 在启动时汇总打印 N 条失效路由（不中断启动）。
 */
export function buildRoutes(
  entries: readonly RouteEntry[],
  resolveProvider: (uuid: string) => Provider | null,
): RouteTable {
  const routes = new Map<string, RouteTarget>();
  let dropped = 0;
  for (const entry of entries) {
    const provider = resolveProvider(entry.provider);
    if (provider === null || provider.inferenceGatewayApiKey.trim() === "") {
      dropped += 1;
      continue;
    }
    routes.set(entry.name, {
      providerName: entry.provider,
      baseUrl: provider.inferenceGatewayBaseUrl,
      authScheme: provider.inferenceGatewayAuthScheme,
      apiKey: provider.inferenceGatewayApiKey,
      upstreamModel: entry.upstreamModel,
    });
  }
  if (dropped > 0) {
    console.warn(`[gateway] ${dropped} 条模型路由失效（供应商缺失或密钥为空），已跳过`);
  }
  return routes;
}

/**
 * 请求期：查路由表 → 改写 body.model → 组装上游 URL 与头。
 * - 查无路由：404；目标 apiKey 为空：502，不向上游发任何字节。
 * - URL = baseUrl 去尾斜杠 + endpoint + 原 query（query 由 0-server 传入，
 *   "?" 开头原样保留）。
 * - customHeaders 来自 sidecar 透传块 inferenceCustomHeaders，其中托管头
 *   被去重丢弃。
 */
export function planUpstream(
  table: RouteTable,
  msg: RoutableMessage,
  incomingHeaders: IncomingHeaders,
  endpoint: MessagesEndpoint,
  originalQuery: string,
  customHeaders?: Record<string, string>,
): UpstreamPlan {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(msg.body.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new GatewayError(400, "invalid_request_error", "请求体不是合法的 JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new GatewayError(400, "invalid_request_error", "请求体必须是 JSON 对象");
  }
  const alias = typeof parsed.model === "string" ? parsed.model : "";
  const target = table.get(alias);
  if (target === undefined) {
    throw new GatewayError(404, "not_found_error", `没有模型 ${alias || "(空)"} 的路由`);
  }
  if (target.apiKey.trim() === "") {
    throw new GatewayError(502, "api_error", `模型 ${alias} 的供应商密钥为空，请检查供应商配置`);
  }

  const rewritten = { ...parsed, model: target.upstreamModel };
  const body = Buffer.from(JSON.stringify(rewritten), "utf8");
  const url =
    target.baseUrl.replace(/\/+$/, "") + endpoint + normalizeQuery(originalQuery);

  return { url, headers: buildUpstreamHeaders(target, incomingHeaders, customHeaders, body.length), body };
}

function normalizeQuery(query: string): string {
  if (query === "") return "";
  return query.startsWith("?") ? query : `?${query}`;
}

function isManagedHeader(name: string): boolean {
  return MANAGED_HEADERS.has(name) || HOP_BY_HOP_HEADERS.has(name);
}

/** 数组成员取逗号连接（HTTP 重复头语义），undefined 丢弃。 */
function headerValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(", ") : value;
}

function buildUpstreamHeaders(
  target: RouteTarget,
  incomingHeaders: IncomingHeaders,
  customHeaders: Record<string, string> | undefined,
  contentLength: number,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "content-length": String(contentLength),
    "accept": "application/json",
    "accept-encoding": "identity",
  };

  const version = headerValue(incomingHeaders["anthropic-version"]);
  headers["anthropic-version"] = version ?? DEFAULT_ANTHROPIC_VERSION;
  const beta = headerValue(incomingHeaders["anthropic-beta"]);
  if (beta !== undefined) headers["anthropic-beta"] = beta;

  if (target.authScheme === "bearer") {
    headers["authorization"] = `Bearer ${target.apiKey}`;
  } else {
    headers["x-api-key"] = target.apiKey;
  }

  // sidecar 透传块：原样继续转发，但去重托管头。
  if (customHeaders !== undefined) {
    for (const [rawName, value] of Object.entries(customHeaders)) {
      const name = rawName.toLowerCase();
      if (!isManagedHeader(name)) headers[name] = value;
    }
  }

  // Desktop 其余 anthropic-* / x-claude-code-* 头原样透传（去重托管头）。
  for (const [rawName, rawValue] of Object.entries(incomingHeaders)) {
    const name = rawName.toLowerCase();
    if (!name.startsWith("anthropic-") && !name.startsWith("x-claude-code-")) continue;
    if (isManagedHeader(name)) continue;
    const value = headerValue(rawValue);
    if (value !== undefined && !(name in headers)) headers[name] = value;
  }

  return headers;
}
