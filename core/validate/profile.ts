/**
 * profile 字段校验：standard 的单供应商规则，advanced 的
 * port / gatewayToken / gatewayAuthScheme。
 *
 * 标准配置只直连一家供应商，因此所有条目的 provider 必须相同且非空。
 * 纯函数，无副作用；供应商名单由调用方传入。
 */

import type { ValidateResult } from "./route-id.ts";

const MIN_PORT = 1;
const MAX_PORT = 65535;
const AUTH_SCHEMES = ["x-api-key", "bearer"] as const;

/**
 * 标准配置单供应商规则：所有条目的 provider 相同且非空。
 * 空数组视为通过（尚无条目时无可校验对象；首个条目在上层强制选定 provider）。
 */
export function validateStandardProviders(
  entries: readonly { provider: string }[],
): ValidateResult {
  let expected: string | null = null;
  for (const [i, entry] of entries.entries()) {
    const provider = entry.provider;
    if (typeof provider !== "string" || provider.length === 0) {
      return {
        ok: false,
        message: `第 ${i + 1} 个模型条目的 provider 为空。标准配置只直连一家供应商，请先选定 provider 再添加模型。`,
      };
    }
    if (expected === null) {
      expected = provider;
    } else if (provider !== expected) {
      return {
        ok: false,
        message: `标准配置只直连一家供应商，但第 ${i + 1} 个条目的 provider 与第一个不同（${provider} ≠ ${expected}）。请拆成多个 profile 或改用高级配置。`,
      };
    }
  }
  return { ok: true };
}

/** 网关监听端口：1–65535 的整数。 */
export function validatePort(p: number): ValidateResult {
  if (typeof p !== "number" || Number.isNaN(p)) {
    return { ok: false, message: "端口必须是数字。" };
  }
  if (!Number.isInteger(p)) {
    return { ok: false, message: `端口必须是整数，当前是 ${p}。范围 ${MIN_PORT}–${MAX_PORT}。` };
  }
  if (p < MIN_PORT || p > MAX_PORT) {
    return {
      ok: false,
      message: `端口须在 ${MIN_PORT}–${MAX_PORT} 之间，当前是 ${p}。`,
    };
  }
  return { ok: true };
}

/** 网关 token：Desktop 连网关的 Bearer token，任意非空字符串。 */
export function validateGatewayToken(t: string): ValidateResult {
  if (typeof t !== "string" || t.length === 0) {
    return { ok: false, message: "网关 token 不能为空，请填任意非空字符串。" };
  }
  return { ok: true };
}

/** Desktop→网关这一跳的鉴权方案：x-api-key 或 bearer（默认 bearer）。 */
export function validateGatewayAuthScheme(s: string): ValidateResult {
  if ((AUTH_SCHEMES as readonly string[]).includes(s)) {
    return { ok: true };
  }
  return {
    ok: false,
    message: `网关鉴权方案只支持 ${AUTH_SCHEMES.join(" 或 ")}，当前是 "${String(s)}"。`,
  };
}
