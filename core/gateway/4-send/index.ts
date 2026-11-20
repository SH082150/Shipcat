/**
 * 4-send — 发送（→ 供应商）：把 3-route-out 组装好的上游请求按 URL 协议
 * 发出（http/https 全局 Agent 连接池复用连接），响应原样移交 5-receive-
 * upstream；连接层失败（DNS/TLS/拒绝）→ 502。不做重试。
 */

import http from "node:http";
import https from "node:https";
import type { IncomingHttpHeaders, RequestOptions } from "node:http";
import type { Readable } from "node:stream";

import { GatewayError } from "../errors/index.ts";

/** 上游响应句柄：状态码、头、数据流，本层不消费流。 */
export interface UpstreamResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly stream: Readable;
}

/** 发送句柄：response 落定上游响应（或 502 失败）；abort 掐断上游请求。 */
export interface SendHandle {
  readonly response: Promise<UpstreamResponse>;
  readonly abort: () => void;
}

/** 全局连接池：跨请求复用 TCP/TLS 连接，避免每请求重新握手。 */
const agents = {
  http: new http.Agent({ keepAlive: true }),
  https: new https.Agent({ keepAlive: true }),
};

export interface UpstreamPlan {
  /** 完整上游 URL（含 /v1/messages 与 query）。 */
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}

export interface SendWatch {
  /** 由 0-server 接线：Desktop 断开时调传入的 abort，掐断上游请求。 */
  readonly onClientGone: (abort: () => void) => void;
}

export function sendUpstream(plan: UpstreamPlan, watch: SendWatch): SendHandle {
  let parsed: URL;
  try {
    parsed = new URL(plan.url);
  } catch {
    throw new GatewayError(502, "api_error", "上游地址无效");
  }
  const transport = parsed.protocol === "https:" ? https : http;

  let abortRef: () => void = () => {};
  const response = new Promise<UpstreamResponse>((resolve, reject) => {
    const options: RequestOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method: "POST",
      headers: plan.headers,
      agent: agents[parsed.protocol === "https:" ? "https" : "http"],
    };
    const req = transport.request(options, (res) => {
      resolve({
        status: res.statusCode ?? 502,
        headers: res.headers,
        stream: res,
      });
    });
    req.on("error", () => {
      reject(new GatewayError(502, "api_error", "上游连接失败"));
    });
    req.write(plan.body);
    req.end();
    abortRef = () => {
      req.destroy();
    };
  });

  const abort = (): void => {
    abortRef();
  };
  watch.onClientGone(abort);
  return { response, abort };
}
