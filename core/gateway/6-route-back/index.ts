/**
 * 6-route-back：回程的加工站——滤掉不能透传给 Desktop 的传输头
 * （hop-by-hop 表），其余头原样保留（content-type、anthropic-ratelimit-*、
 * x-should-retry、retry-after、request-id 都留给 Desktop）。
 *
 * 响应体只做一件事：把上游返回的模型名换回客户端请求的别名（交给 7-reply
 * 按 JSON / SSE 分别处理）；其余字节、事件边界、ping、错误原文原样透传。
 */

import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import type { Readable } from "node:stream";

import { replyToDesktop } from "../7-reply/index.ts";

/**
 * hop-by-hop 表：与上游连接绑定、不能透传给 Desktop 的传输头
 * （与 3-route-out 各存一份——刻意重复，换流程定位清晰）。Node 入站
 * 头名已全小写，直接比对即可；proxy-* 统配其余代理头。
 */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** 上游响应句柄（与 5-receive-upstream 的移交结构同形，结构类型自动兼容）。 */
interface UpstreamHandle {
  readonly statusCode: number;
  readonly headers: IncomingHttpHeaders;
  readonly stream: Readable;
}

/** 过滤后的响应描述：7-reply 的全部输入。 */
export interface FilteredResponse {
  readonly status: number;
  readonly filteredHeaders: IncomingHttpHeaders;
  readonly upstreamStream: Readable;
}

/** 剔除 hop-by-hop 表中的头，其余头原样保留（含 undefined 值一并丢弃）。 */
export function filterResponseHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const filtered: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP.has(name) || name.startsWith("proxy-")) continue;
    filtered[name] = value;
  }
  return filtered;
}

/** 回程加工：滤头 → 产出 { status, filteredHeaders, upstreamStream } → 7-reply。 */
export function routeBack(
  upstream: UpstreamHandle,
  clientRes: ServerResponse,
  options: { readonly requestModel?: string } = {},
): void {
  replyToDesktop(
    {
      status: upstream.statusCode,
      filteredHeaders: filterResponseHeaders(upstream.headers),
      upstreamStream: upstream.stream,
    },
    clientRes,
    options,
  );
}
