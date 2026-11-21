/**
 * plan：把一次字段级漂移翻译成界面可直接渲染的同步计划。
 *
 * 只读：不写 sidecar、不写 Claude 文件。输出分三类（基本信息 / 模型 /
 * 透传），每项都带 Shipcat 当前值与 Claude 当前值；最终值由界面填写，
 * 交给 apply 落盘。
 */

import { read as readClaudeMeta } from "../archive/claude-meta/index.ts";
import { parseClaudeValue } from "../archive/claude-block/index.ts";
import { readProfilePair, valuesEqual } from "../check/gate.ts";
import type { CheckOptions } from "../check/gate.ts";

export type SyncCategory = "basic" | "model" | "passthrough";

export type SyncKind = "text" | "number" | "boolean" | "select" | "json" | "secret";

/** 一侧的值：present=false 表示该侧没有这个项。 */
export interface SyncValue {
  readonly present: boolean;
  /** 可直接展示/编辑的文本；secret 时为空，由界面显示掩码。 */
  readonly text: string;
  /** 密钥类字段：只展示掩码，不输出明文。 */
  readonly secret?: boolean;
  /** Claude 侧是 __sealed__: 密文，无法读取/导入。 */
  readonly sealed?: boolean;
  /** 密钥类的实际值（界面用密码框编辑，不直接展示）。 */
  readonly raw?: string;
}

export interface SyncField {
  /** 稳定的应用路径：name / port / authScheme / gatewayToken / 透传键 / 模型字段。 */
  readonly path: string;
  readonly category: SyncCategory;
  /** 模型名；基本信息为 "gateway"；透传为 "passthrough"。 */
  readonly group: string;
  /** 语义字段名（界面负责翻译成中文）。 */
  readonly field: string;
  readonly kind: SyncKind;
  readonly local: SyncValue;
  readonly claude: SyncValue;
  /** Claude 值能否作为最终值；standard URL / 密钥类为 false。 */
  readonly importable: boolean;
}

export interface SyncModel {
  readonly index: number;
  readonly name: string;
  readonly status: "changed" | "local-only" | "claude-only";
  readonly fields: readonly SyncField[];
  /** 本地 sidecar 的供应商引用（advanced 新增模型时界面需要选择）。 */
  readonly provider?: string;
  readonly upstreamModel?: string;
  /** Claude 新增模型：界面需要补供应商。 */
  readonly needsProvider: boolean;
  /** Claude 新增的 advanced 模型：界面需要补上游模型。 */
  readonly needsUpstream: boolean;
}

export interface SyncPlan {
  readonly id: string;
  readonly name: string;
  readonly mode: "standard" | "advanced";
  readonly basic: readonly SyncField[];
  readonly models: readonly SyncModel[];
  readonly passthrough: readonly SyncField[];
  /** Claude profile 文件缺失：界面应提示重建，而不是逐项比较。 */
  readonly fileMissing: boolean;
}

/** 模型里参与比对的字段（provider/upstreamModel 在 Claude 文件里不存在）。 */
const MODEL_FIELDS = [
  "name",
  "labelOverride",
  "supports1m",
  "prefer1m",
  "anthropicFamilyTier",
  "isFamilyDefault",
  "behavesAs",
  "maxEffort",
] as const;

const MANAGED_KEYS = new Set([
  "inferenceProvider",
  "inferenceCredentialKind",
  "inferenceGatewayBaseUrl",
  "inferenceGatewayApiKey",
  "inferenceGatewayAuthScheme",
  "inferenceModels",
]);

const SEALED_PREFIX = "__sealed__:";

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

function kindOf(value: unknown): SyncKind {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "object" && value !== null) return "json";
  return "text";
}

function sideValue(value: unknown, present = value !== undefined): SyncValue {
  if (!present) return { present: false, text: "" };
  return { present: true, text: textOf(value) };
}

function isSealed(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(SEALED_PREFIX);
}

function fieldOf(
  path: string,
  group: string,
  field: string,
  kind: SyncKind,
  local: SyncValue,
  claude: SyncValue,
  importable: boolean,
): SyncField {
  return { path, category: group === "gateway" ? "basic" : "passthrough", group, field, kind, local, claude, importable };
}

function modelFieldOf(
  index: number,
  group: string,
  field: string,
  kind: SyncKind,
  local: SyncValue,
  claude: SyncValue,
  importable: boolean,
): SyncField {
  return {
    path: `inferenceModels[${index}].${field}`,
    category: "model",
    group,
    field,
    kind,
    local,
    claude,
    importable,
  };
}

function modelKind(field: (typeof MODEL_FIELDS)[number]): SyncKind {
  if (field === "supports1m" || field === "prefer1m" || field === "isFamilyDefault") return "boolean";
  if (field === "anthropicFamilyTier" || field === "maxEffort") return "select";
  return "text";
}

function claudeNameOf(id: string, fallback: string, opts?: CheckOptions): string {
  try {
    return readClaudeMeta(opts).entries.find((entry) => entry.id === id)?.name ?? fallback;
  } catch {
    return fallback;
  }
}

function buildBasic(
  pair: ReturnType<typeof readProfilePair>,
  opts?: CheckOptions,
): SyncField[] {
  const fields: SyncField[] = [];
  const localName = pair.entry.name;
  const claudeName = claudeNameOf(pair.entry.id, localName, opts);
  if (claudeName !== localName) {
    fields.push({
      path: "name",
      category: "basic",
      group: "profile",
      field: "name",
      kind: "text",
      local: { present: true, text: localName },
      claude: { present: true, text: claudeName },
      importable: true,
    });
  }

  const claude = pair.claude ?? {};
  const expected = pair.expected;

  // 生成器固定写入的两个键：Claude 侧改了也只能用 Shipcat 覆盖。
  for (const key of ["inferenceProvider", "inferenceCredentialKind"] as const) {
    if (!valuesEqual(expected[key], claude[key])) {
      fields.push(fieldOf(key, "gateway", key, "text", sideValue(expected[key]), sideValue(claude[key]), false));
    }
  }

  if (pair.profile.mode === "advanced") {
    const localPort = pair.profile.port;
    const claudeUrl = claude.inferenceGatewayBaseUrl;
    const claudePort = typeof claudeUrl === "string" ? portOfUrl(claudeUrl) : null;
    if (claudePort === null || !valuesEqual(localPort, claudePort)) {
      fields.push({
        path: "port",
        category: "basic",
        group: "gateway",
        field: "port",
        kind: "number",
        local: sideValue(localPort),
        claude: claudePort === null ? sideValue(claudeUrl) : sideValue(claudePort),
        importable: claudePort !== null,
      });
    }

    const localScheme = pair.profile.gatewayAuthScheme ?? "bearer";
    const claudeScheme = claude.inferenceGatewayAuthScheme === "x-api-key" ? "x-api-key" : "bearer";
    if (localScheme !== claudeScheme) {
      fields.push({
        path: "authScheme",
        category: "basic",
        group: "gateway",
        field: "authScheme",
        kind: "select",
        local: { present: true, text: localScheme },
        claude: { present: true, text: claudeScheme },
        importable: true,
      });
    }

    const claudeToken = claude.inferenceGatewayApiKey;
    const localToken = pair.profile.gatewayToken;
    if (typeof claudeToken === "string" && !isSealed(claudeToken) && claudeToken !== localToken) {
      fields.push({
        path: "gatewayToken",
        category: "basic",
        group: "gateway",
        field: "gatewayToken",
        kind: "secret",
        local: { present: true, text: "", secret: true, raw: localToken },
        claude: { present: true, text: "", secret: true, raw: claudeToken },
        importable: true,
      });
    }
    // sealed token 无法比较/导入，属于正常状态，不列行。
  } else {
    const localUrl = expected.inferenceGatewayBaseUrl;
    const claudeUrl = claude.inferenceGatewayBaseUrl;
    if (!valuesEqual(localUrl, claudeUrl)) {
      fields.push({
        path: "baseUrl",
        category: "basic",
        group: "gateway",
        field: "baseUrl",
        kind: "text",
        local: sideValue(localUrl),
        claude: sideValue(claudeUrl),
        importable: false,
      });
    }

    const claudeKey = claude.inferenceGatewayApiKey;
    if (typeof claudeKey === "string" && !isSealed(claudeKey)) {
      const localKey = expected.inferenceGatewayApiKey;
      if (!valuesEqual(localKey, claudeKey)) {
        fields.push({
          path: "apiKey",
          category: "basic",
          group: "gateway",
          field: "apiKey",
          kind: "secret",
          local: { present: true, text: "", secret: true },
          claude: { present: true, text: "", secret: true },
          importable: false,
        });
      }
    }

    const localScheme = expected.inferenceGatewayAuthScheme === "x-api-key" ? "x-api-key" : "bearer";
    const claudeScheme = claude.inferenceGatewayAuthScheme === "x-api-key" ? "x-api-key" : "bearer";
    if (localScheme !== claudeScheme) {
      fields.push({
        path: "authScheme",
        category: "basic",
        group: "gateway",
        field: "authScheme",
        kind: "select",
        local: { present: true, text: localScheme },
        claude: { present: true, text: claudeScheme },
        importable: false,
      });
    }
  }

  return fields;
}

function portOfUrl(value: string): number | null {
  try {
    const url = new URL(value);
    if (url.port !== "") return Number(url.port);
    if (url.protocol === "https:") return 443;
    if (url.protocol === "http:") return 80;
    return null;
  } catch {
    return null;
  }
}

function modelEntry(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function buildModels(pair: ReturnType<typeof readProfilePair>): SyncModel[] {
  const localRaw = Array.isArray(pair.expected.inferenceModels) ? pair.expected.inferenceModels : [];
  const claudeRaw = Array.isArray(pair.claude?.inferenceModels) ? pair.claude.inferenceModels : [];
  const sidecar = pair.profile.inferenceModels;
  const models: SyncModel[] = [];
  const total = Math.max(localRaw.length, claudeRaw.length);

  for (let index = 0; index < total; index += 1) {
    const local = modelEntry(localRaw[index]);
    const claude = modelEntry(claudeRaw[index]);
    if (local === null && claude === null) continue;

    const status: SyncModel["status"] =
      local === null ? "claude-only" : claude === null ? "local-only" : "changed";
    const name =
      (typeof local?.name === "string" && local.name) ||
      (typeof claude?.name === "string" && claude.name) ||
      `模型 #${index + 1}`;

    const fields: SyncField[] = [];
    for (const field of MODEL_FIELDS) {
      const localValue = local?.[field];
      const claudeValue = claude?.[field];
      if (status === "changed" && valuesEqual(localValue, claudeValue)) continue;
      if (localValue === undefined && claudeValue === undefined) continue;
      fields.push(
        modelFieldOf(
          index,
          name,
          field,
          modelKind(field),
          sideValue(localValue),
          sideValue(claudeValue),
          status !== "local-only",
        ),
      );
    }
    if (status === "changed" && fields.length === 0) continue;

    const side = sidecar[index] as unknown as Record<string, unknown> | undefined;
    models.push({
      index,
      name,
      status,
      fields,
      ...(typeof side?.provider === "string" ? { provider: side.provider } : {}),
      ...(typeof side?.upstreamModel === "string" ? { upstreamModel: side.upstreamModel } : {}),
      needsProvider: status === "claude-only",
      needsUpstream: status === "claude-only" && pair.profile.mode === "advanced",
    });
  }

  return models;
}

function buildPassthrough(
  pair: ReturnType<typeof readProfilePair>,
): SyncField[] {
  const localBlock = pair.profile.claude ?? {};
  const claude = pair.claude ?? {};
  const expected = pair.expected;
  const keys = new Set<string>([...Object.keys(localBlock)]);
  for (const key of Object.keys(claude)) {
    if (!(key in expected) && !MANAGED_KEYS.has(key)) keys.add(key);
  }

  const fields: SyncField[] = [];
  for (const key of [...keys].sort()) {
    const localPresent = key in localBlock;
    const claudePresent = key in claude;
    const localValue = localPresent ? expected[key] : undefined;
    const claudeValue = claudePresent ? claude[key] : undefined;
    if (localPresent && claudePresent && valuesEqual(localValue, claudeValue)) continue;

    const sealed = isSealed(claudeValue);
    const kindValue = localPresent ? localValue : claudeValue;
    fields.push({
      path: key,
      category: "passthrough",
      group: "passthrough",
      field: key,
      kind: kindOf(kindValue),
      local: sideValue(localValue, localPresent),
      claude: sealed
        ? { present: true, text: "", sealed: true }
        : sideValue(claudeValue, claudePresent),
      importable: !sealed,
    });
  }
  return fields;
}

/**
 * 构建单个档案的同步计划；无漂移时三类都是空数组。
 * readOnly / 文件损坏等由 readProfilePair 抛 CheckError，调用方负责展示。
 */
export function buildSyncPlan(profileId: string, opts?: CheckOptions): SyncPlan {
  const pair = readProfilePair(profileId, opts);
  const mode = pair.profile.mode === "standard" ? "standard" : "advanced";
  if (pair.claude === null) {
    return {
      id: pair.entry.id,
      name: pair.entry.name,
      mode,
      basic: [],
      models: [],
      passthrough: [],
      fileMissing: true,
    };
  }
  return {
    id: pair.entry.id,
    name: pair.entry.name,
    mode,
    basic: buildBasic(pair, opts),
    models: buildModels(pair),
    passthrough: buildPassthrough(pair),
    fileMissing: false,
  };
}

/** 计划里是否还有未处理的差异。 */
export function planHasDrift(plan: SyncPlan): boolean {
  return (
    plan.fileMissing ||
    plan.basic.length > 0 ||
    plan.models.length > 0 ||
    plan.passthrough.length > 0
  );
}

/** 界面需要把文本重新变成 JSON 值时复用同一套规则。 */
export { parseClaudeValue };
