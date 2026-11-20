/**
 * Claude 透传字段目录与校验。
 *
 * sidecar 的 claude 块会原样展开进 Claude profile；这里集中声明已知键与
 * 值类型，写操作与 UI 复用同一份规则。未知键拒绝，避免把拼写错误写进
 * Desktop 配置。
 */

import type { ClaudePassthrough } from "../../types.ts";

export type ClaudeFieldType = "string" | "number" | "boolean" | "json" | "string-array";

export const CLAUDE_FIELD_TYPES: Readonly<Record<keyof ClaudePassthrough, ClaudeFieldType>> = {
  inferenceStreamIdleTimeoutSec: "number",
  inferenceCustomHeaders: "json",
  userContentRendererUrl: "string",
  inferenceGatewayManagedClaudeCode: "boolean",
  inferenceGatewayAutoModeServerChecks: "boolean",
  modelPrefer1mContext: "boolean",
  defaultModelEffort: "string",
  alwaysStartWithDefaultModel: "boolean",
  inferenceModelPricingEnabled: "boolean",
  inferenceModelPricingMultiplier: "number",
  inferenceModelPricing: "json",
  modelCatalogUrl: "string",
  egressProxyUrl: "string",
  egressProxyPacUrl: "string",
  coworkVmIpv6Enabled: "boolean",
  disableDeploymentModeChooser: "boolean",
  deploymentDisplayName: "string",
  desktopHome: "string",
  sshTransport: "string",
  toolSearchEnabled: "boolean",
  skipWebFetchPreflight: "boolean",
  builtinBrowserEnabled: "boolean",
  isDesktopExtensionEnabled: "boolean",
  coworkEgressAllowedHosts: "string-array",
  claudeAiImport: "json",
};

export type ClaudeFieldResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

/** 把 UI 输入（字符串/布尔）按字段类型转换并校验。 */
export function coerceClaudeField(key: string, raw: unknown): ClaudeFieldResult {
  const type = (CLAUDE_FIELD_TYPES as Record<string, ClaudeFieldType | undefined>)[key];
  if (type === undefined) {
    return { ok: false, message: `未知的 Claude 透传字段「${key}」` };
  }
  if (type === "boolean") {
    if (typeof raw === "boolean") return { ok: true, value: raw };
    if (raw === "true" || raw === "false") return { ok: true, value: raw === "true" };
    return { ok: false, message: `字段「${key}」需要 true / false` };
  }
  if (type === "number") {
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(value)) return { ok: false, message: `字段「${key}」需要数字` };
    return { ok: true, value };
  }
  if (type === "json") {
    if (typeof raw !== "string") return { ok: true, value: raw };
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      return { ok: false, message: `字段「${key}」需要合法 JSON` };
    }
  }
  if (type === "string-array") {
    if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) {
      return { ok: true, value: raw };
    }
    if (typeof raw === "string") {
      return { ok: true, value: raw.split(",").map((item) => item.trim()).filter(Boolean) };
    }
    return { ok: false, message: `字段「${key}」需要字符串数组` };
  }
  if (typeof raw !== "string") return { ok: false, message: `字段「${key}」需要字符串` };
  return { ok: true, value: raw };
}

/** 校验整个 claude 块；返回规范化后的对象。 */
export function normalizeClaudeBlock(
  block: Record<string, unknown>,
): { readonly ok: true; readonly value: Record<string, unknown> } | { readonly ok: false; readonly message: string } {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(block)) {
    const result = coerceClaudeField(key, value);
    if (!result.ok) return result;
    out[key] = result.value;
  }
  return { ok: true, value: out };
}
