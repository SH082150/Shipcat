/**
 * generate：sidecar → Desktop profile 生成器。纯函数，不读不写文件。
 *
 * 合并顺序（后者覆盖前者）：claude 透传块原样展开 → CLI 管理键 →
 * inferenceModels（条目删掉 sidecar 自有扩展键）。高级配置写本地网关
 * 地址与 gatewayToken；标准配置同键名复制供应商三件套（key 明文写出，
 * Desktop 自动密封）。readOnly 无期望配置，拒绝生成。
 */

import type { AdvancedModelEntry, HarborProfile, Provider, StandardModelEntry } from "../../types.ts";

/** 结构化错误：code 供程序判断，message 是面向用户的中文描述。 */
export type GenerateErrorCode = "CONFLICT" | "VALIDATION";

export class GenerateError extends Error {
  readonly code: GenerateErrorCode;

  constructor(code: GenerateErrorCode, message: string) {
    super(message);
    this.name = "GenerateError";
    this.code = code;
  }
}

/** 高级配置条目 → Desktop 条目：删掉 provider + upstreamModel。 */
function advancedEntryOf(entry: AdvancedModelEntry): Record<string, unknown> {
  const { provider: _provider, upstreamModel: _upstreamModel, ...rest } = entry;
  return { ...rest };
}

/** 标准配置条目 → Desktop 条目：删掉 provider。 */
function standardEntryOf(entry: StandardModelEntry): Record<string, unknown> {
  const { provider: _provider, ...rest } = entry;
  return { ...rest };
}

/**
 * 由 sidecar 底账生成 Desktop profile JSON。standard 必须附供应商三件套
 * （provider 参数）；advanced 用 sidecar 的 port/gatewayToken/
 * gatewayAuthScheme。readOnly 抛 CONFLICT。
 */
export function generateDesktopProfile(
  profile: HarborProfile,
  provider?: Provider,
): Record<string, unknown> {
  if (profile.mode === "readOnly") {
    throw new GenerateError(
      "CONFLICT",
      "只读镜像（readOnly）是 Claude 外来 profile 的单向镜像，没有可生成的期望配置",
    );
  }

  const out: Record<string, unknown> = { ...(profile.claude ?? {}) };
  out.inferenceProvider = "gateway";
  out.inferenceCredentialKind = "static";

  if (profile.mode === "advanced") {
    if (
      typeof profile.port !== "number" ||
      typeof profile.gatewayToken !== "string" ||
      profile.gatewayToken.length === 0 ||
      (profile.gatewayAuthScheme !== "x-api-key" && profile.gatewayAuthScheme !== "bearer")
    ) {
      throw new GenerateError(
        "VALIDATION",
        "高级配置（advanced）sidecar 缺少网关字段（port / gatewayToken / gatewayAuthScheme），档案结构不完整",
      );
    }
    out.inferenceGatewayBaseUrl = `http://127.0.0.1:${profile.port}`;
    out.inferenceGatewayApiKey = profile.gatewayToken;
    if (profile.gatewayAuthScheme === "x-api-key") {
      out.inferenceGatewayAuthScheme = "x-api-key";
    }
    out.inferenceModels = profile.inferenceModels.map(advancedEntryOf);
    return out;
  }

  // standard：三个 inferenceGateway* 同键名复制自供应商文件。
  if (!provider) {
    throw new GenerateError(
      "VALIDATION",
      "标准配置（standard）生成需要供应商三件套，请附上对应的 Provider",
    );
  }
  const { inferenceGatewayBaseUrl, inferenceGatewayApiKey, inferenceGatewayAuthScheme } = provider;
  if (
    typeof inferenceGatewayBaseUrl !== "string" ||
    inferenceGatewayBaseUrl.length === 0 ||
    typeof inferenceGatewayApiKey !== "string" ||
    inferenceGatewayApiKey.length === 0
  ) {
    throw new GenerateError(
      "VALIDATION",
      "标准配置（standard）引用的供应商档案缺少 inferenceGatewayBaseUrl / inferenceGatewayApiKey，无法生成",
    );
  }
  out.inferenceGatewayBaseUrl = inferenceGatewayBaseUrl;
  out.inferenceGatewayApiKey = inferenceGatewayApiKey;
  if (inferenceGatewayAuthScheme === "x-api-key") {
    out.inferenceGatewayAuthScheme = "x-api-key";
  }
  out.inferenceModels = profile.inferenceModels.map(standardEntryOf);
  return out;
}
