/**
 * 供应商字段校验：写 providers 档案之前的一切规则检查。
 *
 * 纯函数、无副作用、不读文件；查重名单由调用方传入。供应商 name 全局
 * 唯一；baseUrl 是 Anthropic 兼容端点（http/https、无查询参数与片段）。
 * 输出统一为 { ok: true } 或 { ok: false, message }，message 说明怎么修。
 */

/** 校验结果：通过或带中文修复提示的失败。 */
export type ValidationResult = { ok: true } | { ok: false; message: string };

/**
 * providerName 规则：字符集 = 小写字母/数字/连字符；长度 1–32；在已有
 * 名单中唯一。上限取 32，覆盖常见命名且防误粘长串。
 */
const NAME_PATTERN = /^[a-z0-9-]+$/;
const NAME_MIN = 1;
const NAME_MAX = 32;

export function validateProviderName(
  name: string,
  existingNames: readonly string[],
): ValidationResult {
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return {
      ok: false,
      message: `供应商名称长度须为 ${NAME_MIN}–${NAME_MAX} 个字符，当前是 ${name.length} 个`,
    };
  }
  if (!NAME_PATTERN.test(name)) {
    return {
      ok: false,
      message: "供应商名称只能包含小写字母、数字和连字符（-）",
    };
  }
  if (existingNames.includes(name)) {
    return { ok: false, message: `供应商名称「${name}」已存在，请换一个名字` };
  }
  return { ok: true };
}

/**
 * inferenceGatewayBaseUrl 规则：仅 http/https；不含 query（?）与 hash（#）；
 * 必须有主机名。去尾斜杠由调用方负责，这里不处理。
 */
export function validateBaseUrl(url: string): ValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      message: `地址「${url}」不是合法 URL，须以 http:// 或 https:// 开头`,
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, message: "供应商地址只支持 http:// 或 https://" };
  }
  if (!parsed.hostname) {
    return { ok: false, message: "供应商地址缺少主机名" };
  }
  if (parsed.search || parsed.hash) {
    return {
      ok: false,
      message: "供应商地址不能包含查询参数（?）或片段（#）",
    };
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      message: "供应商地址不能内嵌用户名密码（user:pass@），凭据应填在 apiKey 字段",
    };
  }
  return { ok: true };
}
