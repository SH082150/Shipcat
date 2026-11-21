/**
 * gate：字段级一致性门禁。比对 sidecar 生成的期望 profile 与 Claude 侧
 * 实际文件，列出差异由用户取舍；gate 通过是 activate / 起网关的前置门禁。
 *
 * 逐键比对：sealed key 只查存在性；其余语义级深比较（对象键序不敏感，
 * 数组顺序敏感——第一条是默认模型）。Claude 侧文件缺失记一条 "(file)"
 * 差异而非抛错；readOnly profile 拒绝 check。`compareProfile` 是同一次
 * 比对的只读形态，额外返回 Claude 侧存在、期望里没有的顶层键，供巡检使用。
 */

import { join } from "node:path";

import { generateDesktopProfile } from "../archive/generate/index.ts";
import { claudePaths } from "../archive/paths/index.ts";
import { readJson } from "../archive/fs/index.ts";
import { getById as getProvider } from "../archive/providers/index.ts";
import { get as getProfile, meta as profilesMeta } from "../archive/profiles/index.ts";
import type { MetaEntry, StandardModelEntry } from "../types.ts";

/** 调用选项：可注入 home（测试/ --home 全局选项），缺省 resolveHome()（见 core/platform）。 */
export interface CheckOptions {
  readonly home?: string;
}

/** 差异项：字段路径 / 本地值 / Claude 值（值已序列化成短字符串）。 */
export interface Diff {
  /** 字段路径，如 inferenceGatewayBaseUrl、inferenceModels[0].maxEffort。 */
  readonly key: string;
  /** 本地（sidecar 生成）值。 */
  readonly local: string;
  /** Claude 侧值；"（缺失）" 表示 Claude 侧没有这个键。 */
  readonly claude: string;
}

/** gate 的返回：通过或差异清单（供 CLI 打印"字段/本地值/Claude 值"三列）。 */
export type GateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly diffs: Diff[] };

/** 字段级比对结果：gate 只看 diffs，巡检还要看 Claude 侧多出的键。 */
export interface ProfileComparison {
  readonly diffs: Diff[];
  /** Claude 文件有、期望配置没有的顶层键（可能是用户新加的透传项）。 */
  readonly extraKeys: readonly string[];
}

/** 结构化错误（前置条件不满足，非差异）：code 供程序判断，message 面向用户。 */
export type CheckErrorCode = "CONFLICT" | "VALIDATION" | "ARCHIVE_CORRUPT";

export class CheckError extends Error {
  readonly code: CheckErrorCode;

  constructor(code: CheckErrorCode, message: string) {
    super(message);
    this.name = "CheckError";
    this.code = code;
  }
}

/** sealed 密文前缀（Desktop 密封后的 inferenceGatewayApiKey 等）。 */
const SEALED_PREFIX = "__sealed__:";

/** 序列化成长度受限的短字符串，供差异清单显示。 */
function shortOf(value: unknown): string {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    text = stableJsonOf(value);
  }
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

/** 键序稳定的 JSON（对象键排序），保证差异显示不随键序抖动。 */
function stableJsonOf(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonOf).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const body = keys
      .map((k) => `${JSON.stringify(k)}:${stableJsonOf((value as Record<string, unknown>)[k])}`)
      .join(",");
    return `{${body}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 语义级深比较：对象键序不敏感（递归并集键），数组顺序敏感（按下标）。
 * 所有差异以 key 路径追加到 diffs。
 */
function diffValue(key: string, local: unknown, claude: unknown, diffs: Diff[]): void {
  if (Array.isArray(local) || Array.isArray(claude)) {
    if (!Array.isArray(local) || !Array.isArray(claude)) {
      diffs.push({ key, local: shortOf(local), claude: shortOf(claude) });
      return;
    }
    if (local.length !== claude.length) {
      diffs.push({ key, local: `${local.length} 条`, claude: `${claude.length} 条` });
      return;
    }
    for (let i = 0; i < local.length; i++) {
      diffValue(`${key}[${i}]`, local[i], claude[i], diffs);
    }
    return;
  }
  if (isPlainObject(local) && isPlainObject(claude)) {
    // 对象：键序不敏感，键集合并集逐键递归。
    const keys = new Set([...Object.keys(local), ...Object.keys(claude)]);
    for (const k of keys) {
      diffValue(
        key ? `${key}.${k}` : k,
        local[k],
        claude[k],
        diffs,
      );
    }
    return;
  }
  if (!Object.is(local, claude)) {
    diffs.push({ key, local: shortOf(local), claude: shortOf(claude) });
  }
}

/** 按 id 优先、name 次之解析 _meta 条目；查不到抛 CheckError。 */
function resolveEntry(profileId: string, opts?: CheckOptions): MetaEntry {
  const entries = profilesMeta(opts).entries;
  const hit =
    entries.find((e) => e.id === profileId) ?? entries.find((e) => e.name === profileId);
  if (!hit) {
    throw new CheckError("VALIDATION", `profile「${profileId}」不在本地索引里，无法检查`);
  }
  return hit;
}

/** 标准配置取供应商三件套：条目 provider 引用（全部相同）→ 供应商档案。 */
function providerForStandard(
  profile: { inferenceModels: readonly StandardModelEntry[] },
  opts?: CheckOptions,
) {
  const first = profile.inferenceModels[0];
  if (!first || typeof first.provider !== "string" || first.provider.length === 0) {
    throw new CheckError(
      "VALIDATION",
      "标准配置（standard）没有可用的模型条目来确定供应商，无法生成期望配置",
    );
  }
  return getProvider(first.provider, opts);
}

/**
 * 读取一次比对所需的原始材料：本地条目、sidecar、期望配置、Claude 文件。
 * readOnly 抛 CONFLICT；文件损坏抛 ARCHIVE_CORRUPT；文件缺失时 claude 为 null。
 * 供 compareProfile 与同步计划共用，避免两处重复读文件。
 */
export interface ProfilePair {
  readonly entry: MetaEntry;
  readonly profile: ReturnType<typeof getProfile>;
  readonly expected: Record<string, unknown>;
  readonly claude: Record<string, unknown> | null;
}

export function readProfilePair(profileId: string, opts?: CheckOptions): ProfilePair {
  const entry = resolveEntry(profileId, opts);
  const profile = getProfile(entry.id, opts);

  if (profile.mode === "readOnly") {
    throw new CheckError(
      "CONFLICT",
      `只读镜像（readOnly）「${entry.name}」是 Claude 外来 profile 的单向镜像，没有可检查的期望配置`,
    );
  }

  const expected = generateDesktopProfile(
    profile,
    profile.mode === "standard" ? providerForStandard(profile, opts) : undefined,
  );

  const claudeFile = join(claudePaths(opts?.home).configLibrary, `${entry.id}.json`);
  let raw: unknown;
  try {
    raw = readJson(claudeFile);
  } catch (err) {
    throw new CheckError(
      "ARCHIVE_CORRUPT",
      `Claude 侧 profile 文件损坏，无法解析（${entry.id}.json）：${(err as Error).message}`,
    );
  }
  if (raw === null) return { entry, profile, expected, claude: null };
  if (!isPlainObject(raw)) {
    throw new CheckError(
      "ARCHIVE_CORRUPT",
      `Claude 侧 profile 文件形状异常（${entry.id}.json），不是 JSON 对象`,
    );
  }
  return { entry, profile, expected, claude: raw };
}

/**
 * 字段级比对：期望与 Claude 文件逐键比较，并列出 Claude 侧多出的顶层键。
 * 文件缺失给差异项 "(file)" 而不是抛错。
 */
export function compareProfile(profileId: string, opts?: CheckOptions): ProfileComparison {
  const { expected, claude } = readProfilePair(profileId, opts);
  if (claude === null) {
    return { diffs: [{ key: "(file)", local: "<存在>", claude: "缺失" }], extraKeys: [] };
  }

  // 只比对我们管理的键；Claude 侧多出的键由 extraKeys 单独返回。
  const diffs: Diff[] = [];
  for (const [key, localValue] of Object.entries(expected)) {
    if (!(key in claude)) {
      diffs.push({ key, local: shortOf(localValue), claude: "（缺失）" });
      continue;
    }
    const claudeValue = claude[key];
    // sealed 键只查存在性：Claude 侧是 "__sealed__:" 密文时不比值。
    if (typeof claudeValue === "string" && claudeValue.startsWith(SEALED_PREFIX)) {
      continue;
    }
    diffValue(key, localValue, claudeValue, diffs);
  }

  const extraKeys = Object.keys(claude).filter((key) => !(key in expected)).sort();
  return { diffs, extraKeys };
}
/** 激活门禁：只看字段差异，通过或返回差异清单。 */
export function gate(profileId: string, opts?: CheckOptions): GateResult {
  const { diffs } = compareProfile(profileId, opts);
  return diffs.length === 0 ? { ok: true } : { ok: false, diffs };
}

/** 语义相等：复用差异比较，忽略对象键序、数组顺序敏感。 */
export function valuesEqual(local: unknown, claude: unknown): boolean {
  const diffs: Diff[] = [];
  diffValue("", local, claude, diffs);
  return diffs.length === 0;
}
