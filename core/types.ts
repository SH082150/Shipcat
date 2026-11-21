/**
 * 领域模型：ClaudeHarbor 的核心数据结构。
 *
 * 供应商与模型分离：供应商只有 baseUrl + key，模型在路由层绑定。
 * 两种配置：standard（直连）与 advanced（网关路由）。要生成给 Desktop
 * 的数据镜像其键名、类型与顺序。
 */

/** Claude 模型档位。Claude Desktop 依据档位做智能体任务的模型分工。 */
export type ModelTier = "haiku" | "sonnet" | "opus" | "fable" | "mythos";

/**
 * 一家上游供应商。只描述"怎么连"，不描述"用哪个模型"——一个供应商可以
 * 被多个条目引用（它的不同模型）。属于全局供应商配置库，两种配置共享。
 */
export interface Provider {
  /** 格式版本，固定 1。 */
  readonly version: 1;
  /** Anthropic 兼容端点，如 https://api.deepseek.com/anthropic。与 Desktop 网关凭证段同键名。 */
  readonly inferenceGatewayBaseUrl: string;
  /** 供应商密钥。与 Desktop 同键名。 */
  readonly inferenceGatewayApiKey: string;
  /** 认证方式：x-api-key 或 bearer。与 Desktop 同键名。 */
  readonly inferenceGatewayAuthScheme: "x-api-key" | "bearer";
}

/**
 * 模型条目：镜像 Claude Desktop 的 inferenceModels 条目——键名、类型、
 * 顺序与 Desktop JSON 完全一致，生成时删掉自有扩展键即可。可选字段不设
 * 就不写入文件。name 规则：含 claude/anthropic + 不含厂商名 + 末尾不要
 * 8 位纯数字（会被 Desktop 当日期剥掉）。
 */
export interface ModelEntry {
  /** Claude 侧模型 ID。 */
  readonly name: string;
  /** 模型选择器里显示的名字；留空时 Desktop 自动格式化。 */
  readonly labelOverride?: string;
  /** 提供 1M 上下文变体。 */
  readonly supports1m?: boolean;
  /** 只显示 1M 选项（依赖 supports1m）。 */
  readonly prefer1m?: boolean;
  /** 档位别名：Desktop 需要该档位进行智能体分工时用这个条目顶上。 */
  readonly anthropicFamilyTier?: ModelTier;
  /** 该档位的默认项。 */
  readonly isFamilyDefault?: boolean;
  /** 兜底：Desktop 不认识 name 时等效为的 Claude 官方模型 ID。 */
  readonly behavesAs?: string;
  /** 该模型的思考强度上限（low/medium/high/xhigh/max）。 */
  readonly maxEffort?: "low" | "medium" | "high" | "xhigh" | "max";
}

/**
 * 标准配置的模型条目 = 模型条目 + `provider`（无上游映射，name 原样
 * 直发供应商）。校验规则：一个标准配置内所有条目的 provider 必须相同
 * （只直连一家），这是规则而非结构限制。
 */
export interface StandardModelEntry extends ModelEntry {
  /** 引用的供应商 UUID v4（= 文件名 = providers/_meta.json entries 里的 id）。 */
  readonly provider: string;
}

/**
 * 高级配置的模型条目 = 模型条目 + `provider` + `upstreamModel`（真身）：
 * Desktop 请求 model = name 时，网关把 model 改写为 upstreamModel
 * 并附上对应供应商的 key 转发。
 */
export interface AdvancedModelEntry extends ModelEntry {
  /** 引用的供应商 UUID v4（= 文件名 = providers/_meta.json entries 里的 id）。 */
  readonly provider: string;
  /** 上游真实模型 ID，如 deepseek-chat。 */
  readonly upstreamModel: string;
}

interface ProfileBase {
  /** 格式版本，固定 1。 */
  readonly version: 1;
  /** 透传块：profile 级 Desktop 字段，生成时原样合并。 */
  readonly claude?: ClaudePassthrough;
}

/**
 * Claude 透传块：Desktop profile 级的附加字段，原样合并进生成的 profile。
 * 键名不做枚举——3p 客户端升级随时可能新增字段，本程序不维护字段目录；
 * CLI 管理的键（inferenceProvider / inferenceCredentialKind /
 * inferenceGatewayBaseUrl / inferenceGatewayApiKey /
 * inferenceGatewayAuthScheme / inferenceModels）由生成器覆盖。
 */
export type ClaudePassthrough = Record<string, unknown>;

/**
 * 标准配置：直连，不启动本地网关。有且仅有一个供应商（所有条目的
 * provider 相同且非空）；供应商文件的三个 inferenceGateway* 字段同键名
 * 复制进 Claude profile（Desktop 自动密封 key）；name 原样直发供应商。
 * 文件内不存 ProfileID 和名字——身份由文件名承载，显示名在 _meta.json。
 */
export interface StandardProfile extends ProfileBase {
  readonly mode: "standard";
  /** 模型条目（镜像 Desktop inferenceModels + provider）。 */
  readonly inferenceModels: readonly StandardModelEntry[];
}

/**
 * 高级配置：网关路由。Claude 侧写假模型名，本地网关按对照表改写后转发。
 * 一个 profile 可挂多家供应商。
 */
export interface AdvancedProfile extends ProfileBase {
  readonly mode: "advanced";
  /** 模型/路由条目（镜像 Desktop inferenceModels + provider + upstreamModel）；name 全局唯一。 */
  readonly inferenceModels: readonly AdvancedModelEntry[];
  /** 监听端口；激活时网关绑定此端口。用户指定（同时只激活一个，无冲突）。 */
  readonly port: number;
  /** Desktop 连网关的 Bearer token：用户填写，任意非空字符串。 */
  readonly gatewayToken: string;
  /** Desktop→网关这一跳的鉴权方案（x-api-key 或 bearer，默认 bearer）。
   * 与供应商的 inferenceGatewayAuthScheme（网关→供应商）相互独立。 */
  readonly gatewayAuthScheme: "x-api-key" | "bearer";
}

/**
 * 只读镜像：import 从 Claude 侧已有 profile 生成（mode 固定 readOnly）。
 * 只查看、不可激活：条目无 provider / upstreamModel，密钥等捞不回的信息
 * 不追求。接管使用须先转为 standard/advanced。
 */
export interface ReadOnlyProfile extends ProfileBase {
  readonly mode: "readOnly";
  /** 从 Claude profile 原样复制的模型条目（纯 Desktop 字段）。 */
  readonly inferenceModels: readonly ModelEntry[];
}

export type HarborProfile = StandardProfile | AdvancedProfile | ReadOnlyProfile;

/** _meta.json 索引条目（providers 和 profiles 共用，学 Claude 的 {id, name}）。 */
export interface MetaEntry {
  readonly id: string;
  readonly name: string;
}

/** providers/_meta.json：纯索引，无激活概念。 */
export interface ProvidersMeta {
  readonly version: 1;
  readonly entries: readonly MetaEntry[];
}

/**
 * profiles/_meta.json：索引 + 激活记录。appliedId 是 Claude _meta.json
 * appliedId 的镜像，供 CLI 本地查询；无激活时为 null。
 */
export interface ProfilesMeta {
  readonly version: 1;
  readonly appliedId: string | null;
  readonly entries: readonly MetaEntry[];
}
