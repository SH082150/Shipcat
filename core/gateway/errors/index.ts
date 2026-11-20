/**
 * 网关错误信封：全项目自产错误的唯一格式出口（Anthropic 错误结构，
 * Desktop 只认它）。上游错误原样透传、不经此处，但格式同源。
 * 消息面向用户可读（中文），不泄露内部路径与 key 片段。
 */

import type { ServerResponse } from "node:http";

/** 网关自产错误：状态码 + Anthropic 错误 type + 用户可读消息。 */
export class GatewayError extends Error {
  readonly status: number;
  readonly type: string;

  constructor(status: number, type: string, message: string) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.type = type;
  }
}

/** 按 Anthropic 信封组装错误体：{"type":"error","error":{type,message}}。 */
export function errorBody(type: string, message: string): object {
  return { type: "error", error: { type, message } };
}

/** 按 Anthropic 信封把错误写成可 end 给客户端的 HTTP 响应。 */
export function sendError(res: ServerResponse, err: GatewayError): void {
  const body = JSON.stringify(errorBody(err.type, err.message));
  res.writeHead(err.status, { "content-type": "application/json" });
  res.end(body);
}
