/**
 * 1-receive — 旅程第一站：收齐 Desktop 发来的请求体并解析校验。
 *
 * 失败全部以 GatewayError 告终（413 超限 / 400 非法 JSON / 400 结构不合法），
 * 由 0-server 统一回响应；成功则把原始字节与解析结果一起交给下一站。
 */

import type { IncomingMessage } from "node:http";

import { GatewayError } from "../errors/index.ts";

/** 请求体上限 32MB（图片消息可能很大）。 */
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

/** 收齐解析后的消息：转发用原始字节还是重序列化由 3-route-out 决定。 */
export interface ReceivedMessage {
  /** 解析后的 JSON 对象。 */
  body: Record<string, unknown>;
  /** 重序列化前的原始字节。 */
  raw: Buffer;
}

/**
 * 收齐 body（流式累加，超 MAX_BODY_BYTES 立即抛 413）、JSON.parse、
 * 校验是对象且 model 是非空字符串；否则抛 400。
 */
export async function receiveMessage(req: IncomingMessage): Promise<ReceivedMessage> {
  const chunks: Buffer[] = [];
  let total = 0;

  const raw = await new Promise<Buffer>((resolve, reject) => {
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        // 停止消费但不断开 socket（0-server 还要回 413 响应），排空剩余数据。
        req.removeAllListeners("data");
        req.resume();
        reject(
          new GatewayError(413, "request_too_large", "请求体超过 32MB 上限，请减小图片或消息内容后重试"),
        );
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new GatewayError(400, "invalid_request_error", "请求体不是合法 JSON，请检查客户端配置");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new GatewayError(400, "invalid_request_error", "请求体必须是 JSON 对象");
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.model !== "string" || body.model.trim() === "") {
    throw new GatewayError(400, "invalid_request_error", "请求体缺少 model 字段（应为非空字符串）");
  }

  return { body, raw };
}
