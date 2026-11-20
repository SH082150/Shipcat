/**
 * profiles 库：管理 ~/.claudeharbor/profiles/ 的 sidecar 底账与 _meta.json
 * （含 appliedId 激活镜像）。UUID v4 是唯一身份（文件名 = _meta.id），
 * sidecar 内不存 ID 和名字；name 只存 _meta。
 *
 * 三种 mode：standard（条目带 provider）/ advanced（条目再带
 * upstreamModel，sidecar 含网关三件套）/ readOnly（Claude 外来镜像，
 * 一切写操作拒绝，只可删两侧）。sidecar 含透传凭证，统一按 600 权限。
 *
 * 写操作同步到 Claude 侧：advanced 总是可生成；standard 需至少一条
 * 条目且 provider 可解析才生成。_meta 缺失/损坏时从 sidecar 目录重建。
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { claudePaths, harborPaths } from "../paths/index.ts";
import type { HarborPaths } from "../paths/index.ts";
import { atomicWriteJson, NORMAL_MODE, readJson, SECRET_MODE } from "../fs/index.ts";
import { list as listProviders, getById } from "../providers/index.ts";
import { generateDesktopProfile } from "../generate/index.ts";
import { normalizeClaudeBlock } from "../claude-fields/index.ts";
import {
  removeEntry as claudeMetaRemoveEntry,
  upsertEntry as claudeMetaUpsertEntry,
} from "../claude-meta/index.ts";
import {
  validateGatewayAuthScheme,
  validateGatewayToken,
  validatePort,
  validateRouteId,
  validateStandardProviders,
} from "../../validate/index.ts";
import type {
  AdvancedModelEntry,
  ClaudePassthrough,
  HarborProfile,
  MetaEntry,
  ModelTier,
  ProfilesMeta,
  Provider,
  StandardModelEntry,
} from "../../types.ts";

/** 调用选项：可注入 home（测试/ --home 全局选项），缺省 resolveHome()（见 core/platform）。 */
export interface ProfilesOptions {
  readonly home?: string;
}

/** 鉴权方案：与 sidecar gatewayAuthScheme 同枚举。 */
export type GatewayAuthScheme = "x-api-key" | "bearer";

/**
 * 结构化错误：code 供程序判断，message 是面向用户的中文描述。
 * CONFLICT = 违反 mode 语义；SYNC_FAILED = Claude 侧写盘失败（不回滚）。
 */
export type ProfilesErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "ARCHIVE_CORRUPT"
  | "SYNC_FAILED";

export class ProfilesError extends Error {
  readonly code: ProfilesErrorCode;

  constructor(code: ProfilesErrorCode, message: string) {
    super(message);
    this.name = "ProfilesError";
    this.code = code;
  }
}

/** create 的输入：名字 + mode 及各自字段；条目可在创建时一并带入。 */
export interface CreateProfileInput {
  /** 显示名（纯标签，存 _meta；sidecar 内不存）。 */
  readonly name: string;
  /** standard（直连）或 advanced（网关路由）；readOnly 只能由 import 生成。 */
  readonly mode: "standard" | "advanced";
  /** 仅 advanced：网关监听端口（用户指定）。 */
  readonly port?: number;
  /** 仅 advanced：Desktop 连网关的 token，任意非空字符串。 */
  readonly gatewayToken?: string;
  /** 仅 advanced：Desktop→网关鉴权方案，缺省 bearer。 */
  readonly gatewayAuthScheme?: GatewayAuthScheme;
  /** 初始模型条目（可空；standard 非空时全部条目 provider 必须相同）。 */
  readonly inferenceModels?: readonly ProfileEntryInput[];
  /** 透传块：profile 级 Desktop 字段，生成时原样合并。 */
  readonly claude?: ClaudePassthrough;
}

/** profile 级字段更新：缺省字段保持不变；name 改名只动 _meta。 */
export interface UpdateProfileInput {
  readonly name?: string;
  readonly port?: number;
  readonly gatewayToken?: string;
  readonly gatewayAuthScheme?: GatewayAuthScheme;
  /** 整个 claude 透传块替换；null 表示清除。保留键会被拒绝。 */
  readonly claude?: Record<string, unknown> | null;
}

/**
 * 条目写入输入：standard 必填 provider；advanced 必填 provider +
 * upstreamModel；readOnly 拒绝一切条目写入。
 */
export interface ProfileEntryInput {
  /** Claude 侧模型 ID（routeId 规则：含 claude/anthropic、无厂商名…）。 */
  readonly name: string;
  readonly labelOverride?: string;
  readonly supports1m?: boolean;
  readonly prefer1m?: boolean;
  readonly anthropicFamilyTier?: ModelTier;
  readonly isFamilyDefault?: boolean;
  readonly behavesAs?: string;
  readonly maxEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** 引用的供应商 UUID v4（standard/advanced 必填）。 */
  readonly provider?: string;
  /** 上游真实模型 ID（仅 advanced 必填）。 */
  readonly upstreamModel?: string;
}

/** detailList 的输出行：索引条目 + sidecar 里的 mode。 */
export interface ProfileListItem extends MetaEntry {
  readonly mode: HarborProfile["mode"];
}

/** create 的结果：新索引条目 + 创建时同步到 Claude 侧的落点说明。 */
export interface CreateResult extends MetaEntry {
  /** 创建时是否已把推导的 Claude profile 写入 configLibrary 并登记 Claude _meta。 */
  readonly synced: boolean;
  /** 未同步时的用户提示（standard 无条目 / provider 暂不可解析）；已同步为 null。 */
  readonly note: string | null;
}

/** UUID v4 文件名（小写，含 .json 后缀）。 */
const UUID_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/;

/** profile 显示名长度上限（只要求非空且唯一，取 64）。 */
const NAME_MAX = 64;

// ---------- 路径表 ----------

const pathCache = new Map<string, HarborPaths>();
function p(opts?: ProfilesOptions): HarborPaths {
  const home = opts?.home;
  const key = home ?? "";
  let hit = pathCache.get(key);
  if (hit === undefined) {
    hit = harborPaths(home);
    pathCache.set(key, hit);
  }
  return hit;
}

// ---------- _meta 读写 ----------

/** 宽松校验单条 meta 条目，坏条目丢弃。 */
function asMetaEntry(value: unknown): MetaEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const e = value as Record<string, unknown>;
  if (typeof e.id !== "string" || typeof e.name !== "string") return null;
  return { id: e.id, name: e.name };
}

/**
 * 从 profiles 目录重建 _meta：UUID 文件名恢复 id，name 无法恢复则以 UUID
 * 占位；appliedId 无法恢复记 null。结果落盘并返回。
 */
function rebuildMetaFromDir(dir: string, opts?: ProfilesOptions): ProfilesMeta {
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    files = [];
  }
  const entries = files
    .filter((f) => UUID_FILE_PATTERN.test(f))
    .map((f) => {
      const id = f.slice(0, -".json".length);
      return { id, name: id };
    });
  const meta: ProfilesMeta = { version: 1, appliedId: null, entries };
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(p(opts).profilesMeta, meta, NORMAL_MODE);
  return meta;
}

/**
 * 读 profiles/_meta.json。不存在或损坏时从目录重建：UUID 文件名恢复 id，
 * name 以 UUID 占位（落盘后可用 rename 重新命名）；appliedId 只在形状
 * 合法时保留。
 */
function readMeta(opts?: ProfilesOptions): ProfilesMeta {
  const dir = p(opts).profilesDir;
  let raw: unknown;
  try {
    raw = readJson(p(opts).profilesMeta);
  } catch {
    return rebuildMetaFromDir(dir, opts);
  }
  if (raw === null) return rebuildMetaFromDir(dir, opts);
  if (typeof raw !== "object" || raw === null) return rebuildMetaFromDir(dir, opts);
  const m = raw as Record<string, unknown>;
  if (!Array.isArray(m.entries)) return rebuildMetaFromDir(dir, opts);
  const entries = (m.entries as unknown[])
    .map(asMetaEntry)
    .filter((e): e is MetaEntry => e !== null);
  const appliedId = typeof m.appliedId === "string" ? m.appliedId : null;
  return { version: 1, appliedId, entries };
}

function writeMeta(meta: ProfilesMeta, opts?: ProfilesOptions): void {
  atomicWriteJson(p(opts).profilesMeta, meta, NORMAL_MODE);
}

/**
 * 主动重建 _meta：从 profiles 目录的 UUID 文件名恢复全部条目（name 以
 * UUID 占位、appliedId 记 null），结果落盘并返回。
 */
export function metaRebuild(opts?: ProfilesOptions): MetaEntry[] {
  return [...rebuildMetaFromDir(p(opts).profilesDir, opts).entries];
}

/** _meta 全文（含 appliedId 激活镜像）——CLI 的 ★ 列与 status 查询用。 */
export function meta(opts?: ProfilesOptions): ProfilesMeta {
  return readMeta(opts);
}

/** 写 appliedId 镜像（null = 清除）。scan 清理悬空指针与 activate 登记用。 */
export function setAppliedIdMirror(id: string | null, opts?: ProfilesOptions): void {
  const m = readMeta(opts);
  writeMeta({ version: 1, appliedId: id, entries: m.entries }, opts);
}

/** 按 id 优先、name 次之解析条目；查不到抛 NOT_FOUND。 */
function resolveEntry(meta: ProfilesMeta, idOrName: string): MetaEntry {
  const byId = meta.entries.find((e) => e.id === idOrName);
  if (byId) return byId;
  const byName = meta.entries.find((e) => e.name === idOrName);
  if (byName) return byName;
  throw new ProfilesError("NOT_FOUND", `profile「${idOrName}」不存在`);
}

// ---------- sidecar 读写 ----------

/** 宽松校验 sidecar 内容；坏文件返回 null（调用方决定报错语义）。 */
function asProfile(value: unknown): HarborProfile | null {
  if (typeof value !== "object" || value === null) return null;
  const s = value as Record<string, unknown>;
  if (s.version !== 1) return null;
  if (s.mode !== "standard" && s.mode !== "advanced" && s.mode !== "readOnly") return null;
  if (!Array.isArray(s.inferenceModels)) return null;
  return s as unknown as HarborProfile;
}

function readSidecar(id: string, opts?: ProfilesOptions): HarborProfile {
  let raw: unknown;
  try {
    raw = readJson(join(p(opts).profilesDir, `${id}.json`));
  } catch (err) {
    throw new ProfilesError(
      "ARCHIVE_CORRUPT",
      `profile 档案文件损坏，无法解析（${id}.json）：${(err as Error).message}`,
    );
  }
  const profile = asProfile(raw);
  if (!profile) {
    throw new ProfilesError(
      "ARCHIVE_CORRUPT",
      `profile 档案文件缺失或损坏（${id}.json），请检查 ~/.claudeharbor/profiles/`,
    );
  }
  return profile;
}

/** 由 profile + 新条目数组组装 sidecar 对象（键序与生成的 Claude profile 对齐）。 */
function sidecarOf(
  profile: HarborProfile,
  models: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { version: 1, mode: profile.mode };
  if (profile.mode === "advanced") {
    out.port = profile.port;
    out.gatewayToken = profile.gatewayToken;
    out.gatewayAuthScheme = profile.gatewayAuthScheme;
  }
  out.inferenceModels = models;
  if (profile.claude !== undefined) out.claude = profile.claude;
  return out;
}

/** 写 sidecar（调用方已保证父目录存在）；透传块可能含自定义凭证，统一按敏感档案处理。 */
function writeSidecar(id: string, profile: HarborProfile, models: readonly Record<string, unknown>[], opts?: ProfilesOptions): void {
  atomicWriteJson(join(p(opts).profilesDir, `${id}.json`), sidecarOf(profile, models), SECRET_MODE);
}

// ---------- 创建即同步 ----------

/**
 * 由 sidecar 重推导并覆写 Claude profile，同时在 Claude _meta 登记/更新
 * {id, name} 条目。advanced 总是可生成；standard 需至少一条条目且其
 * provider 可解析，否则返回 false。产物含密钥，用 SECRET_MODE 写入；
 * 写盘失败抛 SYNC_FAILED（不回滚）。
 */
function syncClaudeProfile(
  id: string,
  name: string,
  profile: HarborProfile,
  opts?: ProfilesOptions,
): boolean {
  let generated: Record<string, unknown>;
  if (profile.mode === "advanced") {
    generated = generateDesktopProfile(profile);
  } else {
    const first = profile.inferenceModels[0] as { provider?: unknown } | undefined;
    if (first === undefined || typeof first.provider !== "string") {
      return false;
    }
    let provider: Provider;
    try {
      provider = getById(first.provider, opts);
    } catch {
      return false; // 供应商档案缺失/损坏：按"暂不可生成"跳过，不报错
    }
    generated = generateDesktopProfile(profile, provider);
  }

  const claude = claudePaths(opts?.home);
  try {
    mkdirSync(claude.configLibrary, { recursive: true });
    atomicWriteJson(join(claude.configLibrary, `${id}.json`), generated, SECRET_MODE);
    claudeMetaUpsertEntry({ id, name }, opts);
  } catch (err) {
    throw new ProfilesError(
      "SYNC_FAILED",
      `同步 Claude profile 失败（${id}.json）：${(err as Error).message}；本地档案已更新，请检查 Claude 目录后重试相关操作`,
    );
  }
  return true;
}

// ---------- 校验 ----------

/** profile 显示名规则：非空、长度上限、在 _meta 中唯一（selfId 用于改名排除自己）。 */
function checkProfileName(name: string, entries: readonly MetaEntry[], selfId?: string): void {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new ProfilesError("VALIDATION", "profile 名字不能为空");
  }
  if (name.length > NAME_MAX) {
    throw new ProfilesError("VALIDATION", `profile 名字过长（上限 ${NAME_MAX} 个字符），当前 ${name.length} 个`);
  }
  if (entries.some((e) => e.name === name && e.id !== selfId)) {
    throw new ProfilesError("VALIDATION", `profile「${name}」已存在，请换一个名字`);
  }
}

/** readOnly 铁律：一切写操作（含条目增删改、改名）拒绝；只可删两侧。 */
function assertWritable(profile: HarborProfile): void {
  if (profile.mode === "readOnly") {
    throw new ProfilesError(
      "CONFLICT",
      "只读镜像（readOnly）不允许任何更改；想接管请删除后重新创建 standard/advanced profile",
    );
  }
}

/** 条目输入 → sidecar 条目对象：可选字段不设就不写入。 */
function buildEntry(input: ProfileEntryInput): Record<string, unknown> {
  const out: Record<string, unknown> = { name: input.name };
  if (input.labelOverride !== undefined) out.labelOverride = input.labelOverride;
  if (input.supports1m !== undefined) out.supports1m = input.supports1m;
  if (input.prefer1m !== undefined) out.prefer1m = input.prefer1m;
  if (input.anthropicFamilyTier !== undefined) out.anthropicFamilyTier = input.anthropicFamilyTier;
  if (input.isFamilyDefault !== undefined) out.isFamilyDefault = input.isFamilyDefault;
  if (input.behavesAs !== undefined) out.behavesAs = input.behavesAs;
  if (input.maxEffort !== undefined) out.maxEffort = input.maxEffort;
  if (input.provider !== undefined) out.provider = input.provider;
  if (input.upstreamModel !== undefined) out.upstreamModel = input.upstreamModel;
  return out;
}

/**
 * 条目写入前的 mode 相关校验：routeId 规则 → provider 必填且存在于供应商
 * _meta → advanced 的 upstreamModel 非空。standard 的单供应商规则由调用方
 * 对整条列表调 validateStandardProviders。
 */
function validateEntryForMode(mode: "standard" | "advanced", entry: Record<string, unknown>, opts?: ProfilesOptions): void {
  const routeCheck = validateRouteId(String(entry.name));
  if (!routeCheck.ok) {
    throw new ProfilesError("VALIDATION", routeCheck.message);
  }

  const providerId = entry.provider;
  if (typeof providerId !== "string" || providerId.length === 0) {
    throw new ProfilesError(
      "VALIDATION",
      `模型条目「${String(entry.name)}」必须指定引用的供应商（provider）`,
    );
  }
  const knownProviders = listProviders(opts);
  if (!knownProviders.some((e) => e.id === providerId)) {
    throw new ProfilesError(
      "NOT_FOUND",
      `模型条目「${String(entry.name)}」引用的供应商（UUID：${providerId}）不存在，请先在供应商库添加`,
    );
  }

  if (mode === "advanced") {
    const upstream = entry.upstreamModel;
    if (typeof upstream !== "string" || upstream.length === 0) {
      throw new ProfilesError(
        "VALIDATION",
        `高级配置的模型条目「${String(entry.name)}」必须指定上游真实模型（upstreamModel）`,
      );
    }
  }
}

/** create 时对初始条目列表的统一校验（单条规则 + 条内重名 + standard 单供应商）。 */
function validateInitialModels(mode: "standard" | "advanced", inputs: readonly ProfileEntryInput[], opts?: ProfilesOptions): Record<string, unknown>[] {
  const models = inputs.map(buildEntry);
  const seen = new Set<string>();
  for (const m of models) {
    validateEntryForMode(mode, m, opts);
    const name = String(m.name);
    if (seen.has(name)) {
      throw new ProfilesError("VALIDATION", `同一 profile 内模型条目名字「${name}」重复`);
    }
    seen.add(name);
  }
  if (mode === "standard") {
    const check = validateStandardProviders(models as unknown as readonly { provider: string }[]);
    if (!check.ok) {
      throw new ProfilesError("VALIDATION", check.message);
    }
  }
  return models;
}

// ---------- 公共 API ----------

/**
 * 创建 profile：校验名字与 mode 字段 → 生成 UUID v4 → 写 sidecar（600）→
 * _meta 追加 {id, name} → 同步 Claude profile。standard 暂不可生成时
 * synced=false，note 提示添加条目后自动同步。
 */
export function create(input: CreateProfileInput, opts?: ProfilesOptions): CreateResult {
  const meta = readMeta(opts);
  checkProfileName(input.name, meta.entries);

  let sidecar: Record<string, unknown>;
  if (input.mode === "standard") {
    if (
      input.port !== undefined ||
      input.gatewayToken !== undefined ||
      input.gatewayAuthScheme !== undefined
    ) {
      throw new ProfilesError(
        "VALIDATION",
        "标准配置（standard）不经过本地网关，不能设置 port / gatewayToken / gatewayAuthScheme（这些是高级配置字段）",
      );
    }
    const models = input.inferenceModels
      ? validateInitialModels("standard", input.inferenceModels, opts)
      : [];
    sidecar = { version: 1, mode: "standard", inferenceModels: models };
    if (input.claude !== undefined) sidecar.claude = input.claude;
  } else {
    if (input.port === undefined) {
      throw new ProfilesError("VALIDATION", "高级配置（advanced）必须指定网关监听端口 port");
    }
    const portCheck = validatePort(input.port);
    if (!portCheck.ok) {
      throw new ProfilesError("VALIDATION", portCheck.message);
    }
    if (input.gatewayToken === undefined) {
      throw new ProfilesError("VALIDATION", "高级配置（advanced）必须指定网关 token（gatewayToken），任意非空字符串即可");
    }
    const tokenCheck = validateGatewayToken(input.gatewayToken);
    if (!tokenCheck.ok) {
      throw new ProfilesError("VALIDATION", tokenCheck.message);
    }
    const scheme: GatewayAuthScheme = input.gatewayAuthScheme ?? "bearer";
    const schemeCheck = validateGatewayAuthScheme(scheme);
    if (!schemeCheck.ok) {
      throw new ProfilesError("VALIDATION", schemeCheck.message);
    }
    const models = input.inferenceModels
      ? validateInitialModels("advanced", input.inferenceModels, opts)
      : [];
    sidecar = {
      version: 1,
      mode: "advanced",
      port: input.port,
      gatewayToken: input.gatewayToken,
      gatewayAuthScheme: scheme,
      inferenceModels: models,
    };
    if (input.claude !== undefined) sidecar.claude = input.claude;
  }

  const id = randomUUID();
  const dir = p(opts).profilesDir;
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(
    join(dir, `${id}.json`),
    sidecar,
    SECRET_MODE,
  );
  writeMeta(
    { version: 1, appliedId: meta.appliedId, entries: [...meta.entries, { id, name: input.name }] },
    opts,
  );
  // meta 先行：无论哪种 mode，创建即登记 Claude _meta 条目（名单是真相）。
  // 文件是派生物——standard 无条目时 syncClaudeProfile 不写文件（synced=false），
  // 等 addEntry 后补；这保证 scan 不会把"未同步的 standard"误判为孤儿删掉。
  claudeMetaUpsertEntry({ id, name: input.name }, opts);
  const synced = syncClaudeProfile(id, input.name, sidecar as unknown as HarborProfile, opts);
  return {
    id,
    name: input.name,
    synced,
    note: synced ? null : "尚未同步 Claude 侧文件：添加条目后自动生成",
  };
}

/** 列表：按 _meta 顺序返回全部条目（纯索引，不读 sidecar；带 mode 走 detailList）。 */
export function list(opts?: ProfilesOptions): MetaEntry[] {
  return [...readMeta(opts).entries];
}

/** 带 mode 的列表：逐条读 sidecar 补充 mode；sidecar 损坏抛 ARCHIVE_CORRUPT。 */
export function detailList(opts?: ProfilesOptions): ProfileListItem[] {
  const meta = readMeta(opts);
  return meta.entries.map((e) => ({ ...e, mode: readSidecar(e.id, opts).mode }));
}

/** 按 UUID 或名字查 sidecar 底账。索引无此条抛 NOT_FOUND；档案损坏抛 ARCHIVE_CORRUPT。 */
export function get(idOrName: string, opts?: ProfilesOptions): HarborProfile {
  const meta = readMeta(opts);
  const entry = resolveEntry(meta, idOrName);
  return readSidecar(entry.id, opts);
}

/**
 * 删除 profile：当前激活的拒绝（激活开关在 Claude _meta）；其余删 sidecar
 * 与 _meta 条目，并清理 Claude _meta 条目和 configLibrary 文件（不存在
 * 容忍）。readOnly 也走这条。
 */
export function remove(idOrName: string, opts?: ProfilesOptions): void {
  const meta = readMeta(opts);
  const entry = resolveEntry(meta, idOrName);
  if (meta.appliedId === entry.id) {
    throw new ProfilesError(
      "CONFLICT",
      `profile「${entry.name}」当前处于激活状态，请先在 Claude 侧切换到其他 profile 后再删除`,
    );
  }
  rmSync(join(p(opts).profilesDir, `${entry.id}.json`), { force: true });
  writeMeta(
    { version: 1, appliedId: meta.appliedId, entries: meta.entries.filter((e) => e.id !== entry.id) },
    opts,
  );
  try {
    claudeMetaRemoveEntry(entry.id, opts);
  } catch (err) {
    throw new ProfilesError(
      "SYNC_FAILED",
      `清理 Claude _meta 失败（${entry.id}）：${(err as Error).message}；本地档案已删除，请检查 Claude 目录后手动清理`,
    );
  }
  rmSync(join(claudePaths(opts?.home).configLibrary, `${entry.id}.json`), { force: true });
}

/** 改名：只改 _meta 的 name（sidecar 不含名），并同步 Claude _meta 条目。 */
export function rename(idOrName: string, newName: string, opts?: ProfilesOptions): MetaEntry {
  const meta = readMeta(opts);
  const entry = resolveEntry(meta, idOrName);
  const profile = readSidecar(entry.id, opts);
  assertWritable(profile);
  checkProfileName(newName, meta.entries, entry.id);
  const entries = meta.entries.map((e) => (e.id === entry.id ? { id: e.id, name: newName } : e));
  writeMeta({ version: 1, appliedId: meta.appliedId, entries }, opts);
  try {
    claudeMetaUpsertEntry({ id: entry.id, name: newName }, opts);
  } catch (err) {
    throw new ProfilesError(
      "SYNC_FAILED",
      `同步 Claude _meta 改名失败（${entry.id}）：${(err as Error).message}；本地已改名，请检查 Claude 目录`,
    );
  }
  return { id: entry.id, name: newName };
}

/** CLI 管理的 sidecar 键，不允许出现在 claude 透传块里。 */
const RESERVED_CLAUDE_KEYS = new Set([
  "version",
  "mode",
  "inferenceModels",
  "inferenceProvider",
  "inferenceCredentialKind",
  "inferenceGatewayBaseUrl",
  "inferenceGatewayApiKey",
  "inferenceGatewayAuthScheme",
  "port",
  "gatewayToken",
  "gatewayAuthScheme",
]);

/**
 * 更新 profile 级字段：改名 / advanced 网关三件套 / claude 透传块。
 * 写入后重推导 Claude 文件。
 */
export function updateProfile(
  idOrName: string,
  patch: UpdateProfileInput,
  opts?: ProfilesOptions,
): MetaEntry {
  const meta = readMeta(opts);
  const target = resolveEntry(meta, idOrName);
  const profile = readSidecar(target.id, opts);
  assertWritable(profile);

  const nextName = patch.name ?? target.name;
  checkProfileName(nextName, meta.entries, target.id);

  const next = { ...(profile as unknown as Record<string, unknown>) };

  if (profile.mode === "standard") {
    if (
      patch.port !== undefined ||
      patch.gatewayToken !== undefined ||
      patch.gatewayAuthScheme !== undefined
    ) {
      throw new ProfilesError(
        "VALIDATION",
        "标准配置（standard）不经过本地网关，不能设置 port / gatewayToken / gatewayAuthScheme",
      );
    }
  } else if (profile.mode === "advanced") {
    if (patch.port !== undefined) {
      const portCheck = validatePort(patch.port);
      if (!portCheck.ok) throw new ProfilesError("VALIDATION", portCheck.message);
      next.port = patch.port;
    }
    if (patch.gatewayToken !== undefined) {
      const tokenCheck = validateGatewayToken(patch.gatewayToken);
      if (!tokenCheck.ok) throw new ProfilesError("VALIDATION", tokenCheck.message);
      next.gatewayToken = patch.gatewayToken;
    }
    if (patch.gatewayAuthScheme !== undefined) {
      const schemeCheck = validateGatewayAuthScheme(patch.gatewayAuthScheme);
      if (!schemeCheck.ok) throw new ProfilesError("VALIDATION", schemeCheck.message);
      next.gatewayAuthScheme = patch.gatewayAuthScheme;
    }
  }

  if (patch.claude !== undefined) {
    if (patch.claude === null) {
      delete next.claude;
    } else {
      for (const key of Object.keys(patch.claude)) {
        if (RESERVED_CLAUDE_KEYS.has(key)) {
          throw new ProfilesError(
            "VALIDATION",
            `claude 透传块不能包含 CLI 管理的键「${key}」`,
          );
        }
      }
      const normalized = normalizeClaudeBlock(patch.claude);
      if (!normalized.ok) throw new ProfilesError("VALIDATION", normalized.message);
      next.claude = normalized.value;
    }
  }

  writeSidecar(
    target.id,
    next as unknown as HarborProfile,
    profile.inferenceModels as unknown as readonly Record<string, unknown>[],
    opts,
  );

  if (nextName !== target.name) {
    writeMeta(
      { version: 1, appliedId: meta.appliedId, entries: meta.entries.map((e) => (e.id === target.id ? { id: e.id, name: nextName } : e)) },
      opts,
    );
  }

  syncClaudeProfile(target.id, nextName, next as unknown as HarborProfile, opts);
  return { id: target.id, name: nextName };
}

/** 重新写入条目并允许改 Model ID（按 previousName 定位旧条目）。 */
export function replaceEntry(
  idOrName: string,
  previousName: string,
  entry: ProfileEntryInput,
  opts?: ProfilesOptions,
): void {
  const meta = readMeta(opts);
  const target = resolveEntry(meta, idOrName);
  const profile = readSidecar(target.id, opts);
  assertWritable(profile);

  const built = buildEntry(entry);
  validateEntryForMode(profile.mode as "standard" | "advanced", built, opts);
  const models = profile.inferenceModels.map((m) => ({ ...(m as unknown as Record<string, unknown>) }));
  const idx = models.findIndex((m) => m.name === previousName);
  if (idx < 0) {
    throw new ProfilesError("NOT_FOUND", `profile「${target.name}」里没有模型条目「${previousName}」`);
  }
  const collision = models.some((m, i) => i !== idx && m.name === built.name);
  if (collision) {
    throw new ProfilesError("VALIDATION", `同一 profile 内模型条目名字「${String(built.name)}」已存在`);
  }
  models[idx] = built;
  if (profile.mode === "standard") {
    const check = validateStandardProviders(models as unknown as readonly { provider: string }[]);
    if (!check.ok) throw new ProfilesError("VALIDATION", check.message);
  }
  writeSidecar(target.id, profile, models, opts);
  syncClaudeProfile(
    target.id,
    target.name,
    { ...profile, inferenceModels: models } as unknown as HarborProfile,
    opts,
  );
}

/** 添加模型条目：校验档位规则与同名校验后追加，并重新推导 Claude 侧文件。 */
export function addEntry(idOrName: string, entry: ProfileEntryInput, opts?: ProfilesOptions): void {
  const meta = readMeta(opts);
  const target = resolveEntry(meta, idOrName);
  const profile = readSidecar(target.id, opts);
  assertWritable(profile);

  const built = buildEntry(entry);
  validateEntryForMode(profile.mode as "standard" | "advanced", built, opts);
  const models = profile.inferenceModels.map((m) => ({ ...(m as unknown as Record<string, unknown>) }));
  if (models.some((m) => m.name === built.name)) {
    throw new ProfilesError("VALIDATION", `同一 profile 内模型条目名字「${built.name}」已存在`);
  }
  models.push(built);
  if (profile.mode === "standard") {
    const check = validateStandardProviders(models as unknown as readonly { provider: string }[]);
    if (!check.ok) {
      throw new ProfilesError("VALIDATION", check.message);
    }
  }
  writeSidecar(target.id, profile, models, opts);
  // 重推导覆写 Claude profile；standard 仍不可生成则跳过，保留上次产物。
  syncClaudeProfile(
    target.id,
    target.name,
    { ...profile, inferenceModels: models } as unknown as HarborProfile,
    opts,
  );
}

/** 更新模型条目：按 entry.name 定位既有条目，整条替换为新内容。 */
export function updateEntry(idOrName: string, entry: ProfileEntryInput, opts?: ProfilesOptions): void {
  const meta = readMeta(opts);
  const target = resolveEntry(meta, idOrName);
  const profile = readSidecar(target.id, opts);
  assertWritable(profile);

  const built = buildEntry(entry);
  validateEntryForMode(profile.mode as "standard" | "advanced", built, opts);
  const models = profile.inferenceModels.map((m) => ({ ...(m as unknown as Record<string, unknown>) }));
  const idx = models.findIndex((m) => m.name === built.name);
  if (idx < 0) {
    throw new ProfilesError("NOT_FOUND", `profile「${target.name}」里没有模型条目「${built.name}」`);
  }
  models[idx] = built;
  if (profile.mode === "standard") {
    const check = validateStandardProviders(models as unknown as readonly { provider: string }[]);
    if (!check.ok) {
      throw new ProfilesError("VALIDATION", check.message);
    }
  }
  writeSidecar(target.id, profile, models, opts);
  syncClaudeProfile(
    target.id,
    target.name,
    { ...profile, inferenceModels: models } as unknown as HarborProfile,
    opts,
  );
}

/** 删除模型条目：按 entry.name 定位并移除；条目不存在抛 NOT_FOUND。 */
export function removeEntry(idOrName: string, entry: ProfileEntryInput, opts?: ProfilesOptions): void {
  const meta = readMeta(opts);
  const target = resolveEntry(meta, idOrName);
  const profile = readSidecar(target.id, opts);
  assertWritable(profile);

  const models = profile.inferenceModels.map((m) => ({ ...(m as unknown as Record<string, unknown>) }));
  const idx = models.findIndex((m) => m.name === entry.name);
  if (idx < 0) {
    throw new ProfilesError("NOT_FOUND", `profile「${target.name}」里没有模型条目「${entry.name}」`);
  }
  models.splice(idx, 1);
  writeSidecar(target.id, profile, models, opts);
  // 重推导覆写 Claude profile；standard 条目删空后跳过，保留上次产物。
  syncClaudeProfile(
    target.id,
    target.name,
    { ...profile, inferenceModels: models } as unknown as HarborProfile,
    opts,
  );
}

export type { AdvancedModelEntry, StandardModelEntry };

// ---------- import（单向：只生成本地镜像，不回写 Claude） ----------

/** import 诊断报告：条目数与透传键数。 */
export interface ImportReport {
  /** Claude 侧 profile 的 UUID（= 两侧共同关联键）。 */
  readonly id: string;
  /** 显示名（取自 Claude _meta entries；_meta 缺失或没有该条时以 UUID 占位）。 */
  readonly name: string;
  /** 从 Claude 侧复制的模型条目数。 */
  readonly entryCount: number;
  /** claude 透传块的键数（Claude profile 里除 CLI 管理键与模型段外的顶层键）。 */
  readonly passthroughKeyCount: number;
}

/** CLI 管理的键：不进透传块，生成时由我们覆盖。 */
const CLI_MANAGED_KEYS = new Set([
  "inferenceProvider",
  "inferenceCredentialKind",
  "inferenceGatewayBaseUrl",
  "inferenceGatewayApiKey",
  "inferenceGatewayAuthScheme",
  "inferenceModels",
]);

/** 从 Claude _meta.json 取显示名；文件缺失/损坏/无该条时以 UUID 占位。 */
function claudeNameOf(id: string, opts?: ProfilesOptions): string {
  let raw: unknown;
  try {
    raw = readJson(claudePaths(opts?.home).meta);
  } catch {
    return id;
  }
  if (typeof raw !== "object" || raw === null) return id;
  const entries = (raw as Record<string, unknown>).entries;
  if (!Array.isArray(entries)) return id;
  for (const e of entries) {
    if (typeof e === "object" && e !== null && (e as Record<string, unknown>).id === id) {
      const name = (e as Record<string, unknown>).name;
      if (typeof name === "string" && name.length > 0) return name;
    }
  }
  return id;
}

/**
 * import：把 Claude 侧已有、但无本地 sidecar 的 profile 镜像成 readOnly。
 * sidecar 已存在时抛 CONFLICT；模型条目原样复制，其余非 CLI 管理顶层键
 * 收进 claude 透传块；本地 _meta 的 name 对齐 Claude _meta。
 */
export function importFromClaude(id: string, opts?: ProfilesOptions): ImportReport {
  if (!UUID_FILE_PATTERN.test(`${id}.json`)) {
    throw new ProfilesError("VALIDATION", `「${id}」不是合法的 UUID v4 profile ID`);
  }

  const claude = claudePaths(opts?.home);
  const claudeProfilePath = join(claude.configLibrary, `${id}.json`);
  let raw: unknown;
  try {
    raw = readJson(claudeProfilePath);
  } catch (err) {
    throw new ProfilesError(
      "ARCHIVE_CORRUPT",
      `Claude 侧档案损坏，无法解析（${claudeProfilePath}）：${(err as Error).message}`,
    );
  }
  if (raw === null) {
    throw new ProfilesError(
      "NOT_FOUND",
      `Claude 侧不存在 profile「${id}」（${claudeProfilePath}），无法 import`,
    );
  }
  const src = raw as Record<string, unknown>;

  const meta = readMeta(opts);
  if (existsSync(join(p(opts).profilesDir, `${id}.json`))) {
    throw new ProfilesError(
      "CONFLICT",
      `profile「${id}」已有本地 sidecar，是自有 profile，无需 import（如需按 Claude 现状重建请先删除本地）`,
    );
  }

  const name = claudeNameOf(id, opts);
  if (meta.entries.some((e) => e.name === name && e.id !== id)) {
    throw new ProfilesError(
      "VALIDATION",
      `本地已有名为「${name}」的 profile，与待导入的 Claude profile 重名；请先改名其中一方再 import`,
    );
  }

  const models: unknown[] = Array.isArray(src.inferenceModels) ? [...src.inferenceModels] : [];
  const passthrough: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (!CLI_MANAGED_KEYS.has(key)) passthrough[key] = value;
  }

  const sidecar: Record<string, unknown> = { version: 1, mode: "readOnly", inferenceModels: models };
  if (Object.keys(passthrough).length > 0) sidecar.claude = passthrough;
  const dir = p(opts).profilesDir;
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(join(dir, `${id}.json`), sidecar, SECRET_MODE);

  const entries = meta.entries.some((e) => e.id === id)
    ? meta.entries.map((e) => (e.id === id ? { id, name } : e))
    : [...meta.entries, { id, name }];
  writeMeta({ version: 1, appliedId: meta.appliedId, entries }, opts);

  return { id, name, entryCount: models.length, passthroughKeyCount: Object.keys(passthrough).length };
}
