/**
 * routeId（Claude 侧模型 ID）校验。
 *
 * 规则：
 * ① 含 "claude" 或 "anthropic"（不区分大小写）；
 * ② 不含会被 Desktop 拒绝的其他模型厂商名；
 * ③ 末尾不是 8 位纯数字（会被 Desktop 当日期剥掉）；
 * ④ 长度 1–200 字符，不含空白。
 * 纯函数，无副作用。
 */

/** 校验结果：通过或带中文修复提示的失败原因。 */
import type { ValidationResult } from "./provider.ts";
export type ValidateResult = ValidationResult;

/** Desktop 会拒绝的其他模型厂商名（小写）。 */
const VENDOR_BLACKLIST: readonly string[] = [
  "kimi",
  "moonshot",
  "glm",
  "zhipu",
  "deepseek",
  "seed",
  "qwen",
  "doubao",
];

const MAX_LEN = 200;
/** 末尾 8 位纯数字会被 Desktop 当日期剥掉。 */
const TRAILING_DATE = /\d{8}$/;
const WHITESPACE = /\s/;
const CLAUDEISH = /claude|anthropic/i;

/**
 * 逐项检查 routeId 四规则，全部通过返回 {ok:true}；
 * 否则返回 {ok:false,message}，指出违反哪条并给示例格式。
 */
export function validateRouteId(name: string): ValidateResult {
  if (typeof name !== "string" || name.length === 0 || name.length > MAX_LEN) {
    return {
      ok: false,
      message: `模型 ID 长度须为 1–${MAX_LEN} 字符，当前 ${typeof name === "string" ? name.length : "非字符串"}。示例：claude-sonnet-deepseek-alias`,
    };
  }
  if (WHITESPACE.test(name)) {
    return {
      ok: false,
      message: "模型 ID 不能含空白字符（空格/换行/制表符）。示例：claude-sonnet-4-6",
    };
  }
  if (!CLAUDEISH.test(name)) {
    return {
      ok: false,
      message: '模型 ID 须含 "claude" 或 "anthropic"（不区分大小写），否则 Desktop 选择器不显示。示例：claude-sonnet-4-6',
    };
  }
  const lower = name.toLowerCase();
  const hit = VENDOR_BLACKLIST.find((v) => lower.includes(v));
  if (hit !== undefined) {
    return {
      ok: false,
      message: `模型 ID 不能含厂商名 "${hit}"（Desktop 会过滤掉）。换个不含厂商名的别名，示例：claude-sonnet-main`,
    };
  }
  if (TRAILING_DATE.test(name)) {
    return {
      ok: false,
      message: "模型 ID 末尾不能是 8 位纯数字（会被 Desktop 当日期剥掉）。示例：claude-sonnet-a12345",
    };
  }
  return { ok: true };
}
