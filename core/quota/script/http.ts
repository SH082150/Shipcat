/**
 * 用户脚本可用的受限请求：仅 HTTPS、超时、响应体上限。
 *
 * 这里不解析供应商响应，全部交给用户脚本；返回值结构与 fetch 类似。
 */

import type { QuotaFetch, QuotaHttpInit, QuotaHttpResponse } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 1024 * 1024;

async function readLimited(response: Response): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("响应体超过 1MB 上限");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export const safeFetch: QuotaFetch = async (
  url: string,
  init: QuotaHttpInit = {},
): Promise<QuotaHttpResponse> => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`请求地址不合法：${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error("额度查询只允许 HTTPS 地址。");
  }

  const timeoutMs = Math.min(
    MAX_TIMEOUT_MS,
    Math.max(1_000, Math.trunc(init.timeoutMs ?? DEFAULT_TIMEOUT_MS)),
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = parsed;
    let response: Response | null = null;
    for (let hop = 0; hop < 5; hop += 1) {
      response = await fetch(current, {
        method: init.method ?? "GET",
        headers: init.headers,
        body: init.body,
        signal: controller.signal,
        redirect: "manual",
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null) break;
        const next = new URL(location, current);
        if (next.protocol !== "https:") {
          throw new Error("重定向到了非 HTTPS 地址。");
        }
        current = next;
        continue;
      }
      break;
    }
    if (response === null) throw new Error("请求未返回响应。");
    const bytes = await readLimited(response);
    const text = new TextDecoder().decode(bytes);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      status: response.status,
      ok: response.ok,
      headers,
      url: response.url,
      text,
      json<T = unknown>(): T {
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new Error("响应不是合法 JSON。");
        }
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`额度查询请求失败：${message}`);
  } finally {
    clearTimeout(timer);
  }
};
