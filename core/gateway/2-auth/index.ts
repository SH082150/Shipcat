/**
 * 2-auth — 鉴权门卫（Desktop→网关这一跳的口令核对）。
 *
 * 宽松双头：Authorization 优先（兼容 "Bearer "/"bearer "/无前缀三种写法），
 * 取不到再退 x-api-key；两个都带只看 Authorization。常量时间比对防时序
 * 侧信道。只校验，绝不把 Desktop 的 token 传给任何下游。
 */

import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

/**
 * 按宽松双头规则提取凭证：无 → null。
 * Authorization 优先；剥掉 "Bearer "/"bearer " 前缀后 trim；空白视为未带。
 */
export function extractToken(headers: IncomingHttpHeaders): string | null {
  const auth = headers.authorization;
  if (typeof auth === "string" && auth.trim() !== "") {
    let token = auth.trim();
    if (token.startsWith("Bearer ") || token.startsWith("bearer ")) {
      token = token.slice(7).trim();
    }
    return token === "" ? null : token;
  }
  const key = headers["x-api-key"];
  if (typeof key === "string" && key.trim() !== "") {
    return key.trim();
  }
  return null;
}

/** 常量时间比对请求凭证与期望 token：不抛错，由调用方回 401。 */
export function authenticate(headers: IncomingHttpHeaders, token: string): boolean {
  const presented = extractToken(headers);
  if (presented === null) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(token, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
