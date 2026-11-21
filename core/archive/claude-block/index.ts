/**
 * Claude 透传块：sidecar 的 claude 块原样展开进 Desktop profile 顶层。
 *
 * 键名不做枚举——3p 客户端升级随时可能新增字段，本程序不维护字段目录，
 * 只负责三件事：拒绝危险键、按 JSON 解析值、取出网关自己会用到的自定义头。
 */

import type { ClaudePassthrough } from "../../types.ts";

/** 会污染对象原型或没有意义的键。 */
const FORBIDDEN_KEYS = new Set(["__proto__"]);

export type ClaudeBlockResult =
  | { readonly ok: true; readonly value: ClaudePassthrough }
  | { readonly ok: false; readonly message: string };

/**
 * 透传值转换：字符串先尝试 JSON.parse，成功就用解析结果（布尔/数字/
 * 对象/数组），失败按原字符串保留。非字符串直接透传。
 */
export function parseClaudeValue(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const text = raw.trim();
  if (text.length === 0) return "";
  try {
    return JSON.parse(text);
  } catch {
    return raw;
  }
}

/** 校验并规范化整个 claude 块（键去空白、值按 JSON 解析）。 */
export function normalizeClaudeBlock(block: Record<string, unknown>): ClaudeBlockResult {
  const out: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(block)) {
    const key = rawKey.trim();
    if (key.length === 0) {
      return { ok: false, message: "透传字段的项目名不能为空。" };
    }
    if (FORBIDDEN_KEYS.has(key)) {
      return { ok: false, message: `透传字段不支持保留键「${key}」。` };
    }
    out[key] = parseClaudeValue(rawValue);
  }
  return { ok: true, value: out as ClaudePassthrough };
}

/** 读取透传块里的 inferenceCustomHeaders；非字符串值忽略，空结果返回 undefined。 */
export function readCustomHeaders(claude: ClaudePassthrough | undefined): Record<string, string> | undefined {
  const raw = claude?.inferenceCustomHeaders;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") headers[key] = value;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}
