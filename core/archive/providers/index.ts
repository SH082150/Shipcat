/**
 * 供应商库：管理 ~/.claudeharbor/providers/ —— 一家供应商一个 <UUID>.json
 * （含密钥，权限 600），外加 _meta.json 索引。UUID v4 是唯一身份，name
 * 只存 _meta；引用一律用 UUID。_meta 损坏时从目录重建（name 用 UUID 占位）。
 *
 * 删除前扫描 profiles 的 provider 引用，被引用则拒绝并报告引用者。
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { harborPaths } from "../paths/index.ts";
import type { HarborPaths } from "../paths/index.ts";
import { atomicWriteJson, NORMAL_MODE, readJson, SECRET_MODE } from "../fs/index.ts";
import { validateBaseUrl, validateProviderName } from "../../validate/provider.ts";
import type { MetaEntry, Provider, ProvidersMeta } from "../../types.ts";

/** 调用选项：可注入 home（测试/ --home 全局选项），缺省 resolveHome()（见 core/platform）。 */
export interface ProvidersOptions {
  readonly home?: string;
}

/** 鉴权方案：与 Provider.inferenceGatewayAuthScheme 同枚举。 */
export type AuthScheme = Provider["inferenceGatewayAuthScheme"];

/** update 的补丁：缺省字段保持不变；name 改名只动 _meta。 */
export interface UpdateProviderInput {
  readonly name?: string;
  readonly inferenceGatewayBaseUrl?: string;
  readonly inferenceGatewayApiKey?: string;
  readonly inferenceGatewayAuthScheme?: AuthScheme;
}

/** add 的输入：三件套 + name；authScheme 缺省为 x-api-key。 */
export interface AddProviderInput {
  readonly name: string;
  readonly inferenceGatewayBaseUrl: string;
  readonly inferenceGatewayApiKey: string;
  readonly inferenceGatewayAuthScheme?: AuthScheme;
}

/**
 * 结构化错误：code 供程序判断，message 是面向用户的中文描述。
 * REFERENCED 时 referencedBy 列出引用该供应商的 profile 显示名。
 */
export type ProvidersErrorCode = "VALIDATION" | "NOT_FOUND" | "REFERENCED" | "ARCHIVE_CORRUPT";

export class ProvidersError extends Error {
  readonly code: ProvidersErrorCode;
  /** REFERENCED 时：引用该供应商的 profile 显示名列表。 */
  readonly referencedBy?: readonly string[];

  constructor(code: ProvidersErrorCode, message: string, referencedBy?: readonly string[]) {
    super(message);
    this.name = "ProvidersError";
    this.code = code;
    this.referencedBy = referencedBy;
  }
}

/** UUID v4 文件名（小写，含 .json 后缀）。 */
const UUID_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/;

// ---------- 路径表 ----------

const pathCache = new Map<string, HarborPaths>();
function p(opts?: ProvidersOptions): HarborPaths {
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

/** 宽松校验单条 meta 条目，坏条目丢弃（文件身份在目录里，丢名字不丢数据）。 */
function asMetaEntry(value: unknown): MetaEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const e = value as Record<string, unknown>;
  if (typeof e.id !== "string" || typeof e.name !== "string") return null;
  return { id: e.id, name: e.name };
}

function rebuildMetaFromDir(dir: string, opts?: ProvidersOptions): ProvidersMeta {
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
  const meta: ProvidersMeta = { version: 1, entries };
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(p(opts).providersMeta, meta, NORMAL_MODE);
  return meta;
}

/**
 * 读 providers/_meta.json。不存在或损坏时从目录重建：UUID 文件名恢复 id，
 * name 以 UUID 占位（落盘后可用 rename 重新命名）。
 */
function readMeta(opts?: ProvidersOptions): ProvidersMeta {
  const dir = p(opts).providersDir;
  let raw: unknown;
  try {
    raw = readJson(p(opts).providersMeta);
  } catch {
    return rebuildMetaFromDir(dir, opts);
  }
  if (raw === null) return rebuildMetaFromDir(dir, opts);
  if (
    typeof raw !== "object" ||
    raw === null ||
    !Array.isArray((raw as Record<string, unknown>).entries)
  ) {
    return rebuildMetaFromDir(dir, opts);
  }
  const entries = ((raw as Record<string, unknown>).entries as unknown[])
    .map(asMetaEntry)
    .filter((e): e is MetaEntry => e !== null);
  return { version: 1, entries };
}

function writeMeta(entries: readonly MetaEntry[], opts?: ProvidersOptions): void {
  atomicWriteJson(p(opts).providersMeta, { version: 1, entries }, NORMAL_MODE);
}

// ---------- 档案文件读写 ----------

/** 宽松校验单文件内容；坏文件返回 null（调用方决定报错语义）。 */
function asProvider(value: unknown): Provider | null {
  if (typeof value !== "object" || value === null) return null;
  const p = value as Record<string, unknown>;
  if (p.version !== 1) return null;
  if (typeof p.inferenceGatewayBaseUrl !== "string") return null;
  if (typeof p.inferenceGatewayApiKey !== "string") return null;
  if (p.inferenceGatewayAuthScheme !== "x-api-key" && p.inferenceGatewayAuthScheme !== "bearer") {
    return null;
  }
  return p as unknown as Provider;
}

function readProviderFile(id: string, opts?: ProvidersOptions): Provider | null {
  return asProvider(readJson(join(p(opts).providersDir, `${id}.json`)));
}

// ---------- 引用检查 ----------

/** profile 档案里是否有条目引用了指定供应商 UUID。 */
function hasProviderRef(value: unknown, providerId: string): boolean {
  if (typeof value !== "object" || value === null) return false;
  const models = (value as Record<string, unknown>).inferenceModels;
  if (!Array.isArray(models)) return false;
  return models.some(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      (m as Record<string, unknown>).provider === providerId,
  );
}

/**
 * 扫描 profiles 目录，返回引用该供应商的 profile 显示名列表（无名字时
 * 以 UUID 占位）。这是 remove 的拒绝依据。
 */
function findReferencingProfiles(providerId: string, opts?: ProvidersOptions): string[] {
  const nameById = new Map<string, string>();
  try {
    const metaRaw = readJson(p(opts).profilesMeta);
    if (
      typeof metaRaw === "object" &&
      metaRaw !== null &&
      Array.isArray((metaRaw as Record<string, unknown>).entries)
    ) {
      for (const e of (metaRaw as Record<string, unknown>).entries as unknown[]) {
        const entry = asMetaEntry(e);
        if (entry) nameById.set(entry.id, entry.name);
      }
    }
  } catch {
    // profiles/_meta 不可读时按无名字处理，引用仍能从文件内容查出（以 UUID 占位显示）
  }

  const profilesDirPath = p(opts).profilesDir;
  let files: string[] = [];
  try {
    files = readdirSync(profilesDirPath);
  } catch {
    return [];
  }
  const refs: string[] = [];
  for (const f of files) {
    if (!UUID_FILE_PATTERN.test(f)) continue;
    const id = f.slice(0, -".json".length);
    let data: unknown;
    try {
      data = readJson(join(profilesDirPath, f));
    } catch {
      continue;
    }
    if (hasProviderRef(data, providerId)) refs.push(nameById.get(id) ?? id);
  }
  return refs;
}

/**
 * 主动重建 _meta：从 providers 目录的 UUID 文件名恢复全部条目（name 以
 * UUID 占位）。readMeta 遇损坏文件时也走同一逻辑。
 */
export function metaRebuild(opts?: ProvidersOptions): MetaEntry[] {
  return [...rebuildMetaFromDir(p(opts).providersDir, opts).entries];
}

// ---------- 公共 API ----------

/** 添加供应商：查重并校验三件套，写 600 权限单文件后追加 _meta 索引。 */
export function add(input: AddProviderInput, opts?: ProvidersOptions): MetaEntry {
  const meta = readMeta(opts);
  const existingNames = meta.entries.map((e) => e.name);

  if (existingNames.includes(input.name)) {
    throw new ProvidersError("VALIDATION", `供应商名称「${input.name}」已存在，请换一个名字`);
  }
  const nameCheck = validateProviderName(input.name, existingNames);
  if (!nameCheck.ok) {
    throw new ProvidersError("VALIDATION", nameCheck.message);
  }

  const scheme: AuthScheme = input.inferenceGatewayAuthScheme ?? "x-api-key";
  if (scheme !== "x-api-key" && scheme !== "bearer") {
    throw new ProvidersError(
      "VALIDATION",
      `鉴权方案「${String(scheme)}」无效，只能是 x-api-key 或 bearer`,
    );
  }

  if (!input.inferenceGatewayApiKey) {
    throw new ProvidersError("VALIDATION", "API Key 不能为空");
  }
  const baseUrl = input.inferenceGatewayBaseUrl.replace(/\/+$/, "");
  const urlCheck = validateBaseUrl(baseUrl);
  if (!urlCheck.ok) {
    throw new ProvidersError("VALIDATION", urlCheck.message);
  }

  const id = randomUUID();
  const provider: Provider = {
    version: 1,
    inferenceGatewayBaseUrl: baseUrl,
    inferenceGatewayApiKey: input.inferenceGatewayApiKey,
    inferenceGatewayAuthScheme: scheme,
  };

  const dir = p(opts).providersDir;
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(join(dir, `${id}.json`), provider, SECRET_MODE);
  writeMeta([...meta.entries, { id, name: input.name }], opts);
  return { id, name: input.name };
}

/** 列表：按 _meta 顺序返回全部条目（纯索引，不读单文件；详情走 getById/getByName）。 */
export function list(opts?: ProvidersOptions): MetaEntry[] {
  return [...readMeta(opts).entries];
}

/** 按 UUID 查详情（三件套）。索引无此 id 或档案损坏时抛 ProvidersError。 */
export function getById(id: string, opts?: ProvidersOptions): Provider {
  const meta = readMeta(opts);
  if (!meta.entries.some((e) => e.id === id)) {
    throw new ProvidersError("NOT_FOUND", `供应商（UUID：${id}）不存在`);
  }
  const provider = readProviderFile(id, opts);
  if (!provider) {
    throw new ProvidersError(
      "ARCHIVE_CORRUPT",
      `供应商档案文件缺失或损坏（${id}.json），请检查 ~/.claudeharbor/providers/`,
    );
  }
  return provider;
}

/** 按 UUID 优先、name 次之解析索引条目。 */
function resolveEntry(idOrName: string, opts?: ProvidersOptions): { meta: ProvidersMeta; entry: MetaEntry } {
  const meta = readMeta(opts);
  const entry =
    meta.entries.find((item) => item.id === idOrName) ??
    meta.entries.find((item) => item.name === idOrName);
  if (!entry) {
    throw new ProvidersError("NOT_FOUND", `供应商「${idOrName}」不存在`);
  }
  return { meta, entry };
}

/** 按 name 查三件套详情。不存在抛 NOT_FOUND；档案损坏抛 ARCHIVE_CORRUPT。 */
export function getByName(name: string, opts?: ProvidersOptions): Provider {
  const meta = readMeta(opts);
  const entry = meta.entries.find((e) => e.name === name);
  if (!entry) {
    throw new ProvidersError("NOT_FOUND", `供应商「${name}」不存在`);
  }
  const provider = readProviderFile(entry.id, opts);
  if (!provider) {
    throw new ProvidersError(
      "ARCHIVE_CORRUPT",
      `供应商「${name}」的档案文件缺失或损坏（${entry.id}.json），请检查 ~/.claudeharbor/providers/`,
    );
  }
  return provider;
}

/** 改名：只改 _meta 的 name（纯显示标签，UUID 引用不动）。 */
export function rename(oldName: string, newName: string, opts?: ProvidersOptions): MetaEntry {
  const { meta, entry } = resolveEntry(oldName, opts);
  const others = meta.entries.filter((e) => e.id !== entry.id).map((e) => e.name);
  const check = validateProviderName(newName, others);
  if (!check.ok) {
    throw new ProvidersError("VALIDATION", check.message);
  }
  const entries = meta.entries.map((e) => (e.id === entry.id ? { id: e.id, name: newName } : e));
  writeMeta(entries, opts);
  return { id: entry.id, name: newName };
}

/** 更新供应商：字段补丁 + 可选改名；UUID 不变，档案引用继续有效。 */
export function update(idOrName: string, patch: UpdateProviderInput, opts?: ProvidersOptions): MetaEntry {
  const { meta, entry } = resolveEntry(idOrName, opts);
  const current = readProviderFile(entry.id, opts);
  if (!current) {
    throw new ProvidersError(
      "ARCHIVE_CORRUPT",
      `供应商档案文件缺失或损坏（${entry.id}.json），请检查 ~/.claudeharbor/providers/`,
    );
  }

  const nextName = patch.name ?? entry.name;
  const others = meta.entries.filter((item) => item.id !== entry.id).map((item) => item.name);
  const nameCheck = validateProviderName(nextName, others);
  if (!nameCheck.ok) {
    throw new ProvidersError("VALIDATION", nameCheck.message);
  }

  const nextKey = patch.inferenceGatewayApiKey ?? current.inferenceGatewayApiKey;
  if (!nextKey) {
    throw new ProvidersError("VALIDATION", "API Key 不能为空");
  }
  const nextBaseUrl = (patch.inferenceGatewayBaseUrl ?? current.inferenceGatewayBaseUrl).replace(/\/+$/, "");
  const urlCheck = validateBaseUrl(nextBaseUrl);
  if (!urlCheck.ok) {
    throw new ProvidersError("VALIDATION", urlCheck.message);
  }
  const nextScheme = patch.inferenceGatewayAuthScheme ?? current.inferenceGatewayAuthScheme;
  if (nextScheme !== "x-api-key" && nextScheme !== "bearer") {
    throw new ProvidersError(
      "VALIDATION",
      `鉴权方案「${String(nextScheme)}」无效，只能是 x-api-key 或 bearer`,
    );
  }

  const nextProvider: Provider = {
    version: 1,
    inferenceGatewayBaseUrl: nextBaseUrl,
    inferenceGatewayApiKey: nextKey,
    inferenceGatewayAuthScheme: nextScheme,
  };
  atomicWriteJson(join(p(opts).providersDir, `${entry.id}.json`), nextProvider, SECRET_MODE);
  if (nextName !== entry.name) {
    writeMeta(
      meta.entries.map((item) => (item.id === entry.id ? { id: item.id, name: nextName } : item)),
      opts,
    );
  }
  return { id: entry.id, name: nextName };
}

/**
 * 删除：先查 profiles 的 provider 引用，有引用则拒绝并报告引用者；
 * 否则删单文件并从 _meta 移除。
 */
export function remove(name: string, opts?: ProvidersOptions): void {
  const { meta, entry } = resolveEntry(name, opts);
  const refs = findReferencingProfiles(entry.id, opts);
  if (refs.length > 0) {
    throw new ProvidersError(
      "REFERENCED",
      `供应商「${name}」仍被以下 profile 引用，无法删除：${refs.join("、")}。请先从这些 profile 移除相关模型条目。`,
      refs,
    );
  }
  rmSync(join(p(opts).providersDir, `${entry.id}.json`), { force: true });
  writeMeta(
    meta.entries.filter((e) => e.id !== entry.id),
    opts,
  );
}
