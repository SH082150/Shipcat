/**
 * 7-reply：旅程终点站——把回程的东西交给 Desktop。
 *
 * 默认是"字节管道"：上游来一块就转一块，绝不缓冲整个响应。唯一例外是
 * 把响应里的上游模型名换回客户端请求的路由别名：
 * - application/json：整段缓冲（上限 32 MiB，超出转原始透传），改顶层
 *   `model` 后重算 content-length；
 * - text/event-stream：按事件块转发，只改 `message_start` 块里的
 *   `message.model`，其余事件与字节保持原样；
 * - 其他类型、带 content-encoding、或没有别名时：原始字节管道。
 *
 * Desktop 中途断开（用户按停止）→ 立即 destroy 上游流，避免白烧 token。
 */

import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import type { Readable } from "node:stream";

import type { FilteredResponse } from "../6-route-back/index.ts";

/** JSON 整流缓冲上限；超过后放弃改写，退回原始字节管道。 */
const MAX_REWRITE_BYTES = 32 * 1024 * 1024;

export interface ReplyOptions {
  /** 客户端请求里的路由别名；为空则不改写响应。 */
  readonly requestModel?: string;
}

/** 取响应头单值（数组按 HTTP 语义逗号连接）。 */
function headerOf(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(", ") : value;
}

/** 字节管道：写状态码与过滤后的头，上游流逐块 pipe 给 Desktop。 */
function pipeUnchanged(response: FilteredResponse, clientRes: ServerResponse): void {
  clientRes.writeHead(response.status, response.filteredHeaders);
  response.upstreamStream.pipe(clientRes);
  response.upstreamStream.on("error", () => {
    if (!clientRes.writableEnded) clientRes.destroy();
  });
}

/**
 * 把回程响应交给 Desktop；requestModel 非空时按内容类型改写模型名。
 */
export function replyToDesktop(
  response: FilteredResponse,
  clientRes: ServerResponse,
  options: ReplyOptions = {},
): void {
  const model = options.requestModel?.trim() ?? "";
  const encoding = headerOf(response.filteredHeaders["content-encoding"]);
  const contentType = (headerOf(response.filteredHeaders["content-type"]) ?? "").toLowerCase();

  clientRes.on("close", () => {
    // close 在正常发完后也会触发：只有响应未写完（Desktop 中途断开）才掐断。
    if (!clientRes.writableEnded) response.upstreamStream.destroy();
  });

  if (model === "" || (encoding !== undefined && encoding.toLowerCase() !== "identity")) {
    pipeUnchanged(response, clientRes);
    return;
  }
  if (contentType.includes("text/event-stream")) {
    replyEventStream(response, clientRes, model);
    return;
  }
  if (contentType.includes("application/json")) {
    replyJson(response, clientRes, model);
    return;
  }
  pipeUnchanged(response, clientRes);
}

/** 改写一个 SSE 事件块：只在带 message_start 的块里替换第一个 model 值。 */
function rewriteEventBlock(block: Buffer, model: string): Buffer {
  const text = block.toString("utf8");
  if (!text.includes("message_start") || !text.includes('"model"')) return block;
  const escaped = JSON.stringify(model);
  const next = text.replace(
    /("model"\s*:\s*)"(?:[^"\\]|\\.)*"/,
    (_match: string, prefix: string) => `${prefix}${escaped}`,
  );
  return next === text ? block : Buffer.from(next, "utf8");
}

/** 找事件分隔符（\n\n 或 \r\n\r\n），返回块结束位置（含分隔符）。 */
function eventBoundary(buffer: Buffer): { readonly end: number } | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf < 0 && crlf < 0) return null;
  if (lf >= 0 && (crlf < 0 || lf < crlf)) return { end: lf + 2 };
  return { end: crlf + 4 };
}

/** 带背压的写：Desktop 读得慢就暂停上游。 */
function writeBackpressured(stream: Readable, clientRes: ServerResponse, chunk: Buffer): void {
  if (clientRes.write(chunk)) return;
  stream.pause();
  clientRes.once("drain", () => stream.resume());
}

/** SSE：逐事件转发，只改 message_start 的模型名。 */
function replyEventStream(response: FilteredResponse, clientRes: ServerResponse, model: string): void {
  const headers: IncomingHttpHeaders = { ...response.filteredHeaders };
  delete headers["content-length"];
  clientRes.writeHead(response.status, headers);

  const stream = response.upstreamStream;
  let pending = Buffer.alloc(0) as Buffer;

  stream.on("data", (chunk: Buffer) => {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    let boundary = eventBoundary(pending);
    while (boundary !== null) {
      const block = pending.subarray(0, boundary.end);
      pending = pending.subarray(boundary.end);
      writeBackpressured(stream, clientRes, rewriteEventBlock(block, model));
      boundary = eventBoundary(pending);
    }
  });
  stream.on("end", () => {
    if (pending.length > 0) writeBackpressured(stream, clientRes, rewriteEventBlock(pending, model));
    clientRes.end();
  });
  stream.on("error", () => {
    if (!clientRes.writableEnded) clientRes.destroy();
  });
}

/** 改 JSON 顶层 model；解析失败 / 没有 model / 值未变时返回原 Buffer。 */
function rewriteJsonBody(original: Buffer, model: string): Buffer {
  try {
    const parsed: unknown = JSON.parse(original.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return original;
    const record = parsed as Record<string, unknown>;
    if (typeof record.model !== "string" || record.model === model) return original;
    record.model = model;
    return Buffer.from(JSON.stringify(record), "utf8");
  } catch {
    return original;
  }
}

/** JSON：整流缓冲后改写；超过上限退回原始透传。 */
function replyJson(response: FilteredResponse, clientRes: ServerResponse, model: string): void {
  const stream = response.upstreamStream;
  let chunks: Buffer[] = [];
  let size = 0;
  let overflow = false;

  stream.on("data", (chunk: Buffer) => {
    if (overflow) return;
    chunks.push(chunk);
    size += chunk.length;
    if (size > MAX_REWRITE_BYTES) {
      overflow = true;
      clientRes.writeHead(response.status, response.filteredHeaders);
      for (const part of chunks) clientRes.write(part);
      chunks = [];
      stream.pipe(clientRes);
    }
  });
  stream.on("end", () => {
    if (overflow) return;
    const original = Buffer.concat(chunks);
    const body = rewriteJsonBody(original, model);
    if (body === original) {
      clientRes.writeHead(response.status, response.filteredHeaders);
      clientRes.end(original);
      return;
    }
    clientRes.writeHead(response.status, {
      ...response.filteredHeaders,
      "content-length": String(body.length),
    });
    clientRes.end(body);
  });
  stream.on("error", () => {
    if (!clientRes.writableEnded) clientRes.destroy();
  });
}
