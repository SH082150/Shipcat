/**
 * 额度查询配置库：`~/.claudeharbor/limitprofiles/`。
 *
 * 一供应商一个 <UUID>.json，存用户自己写的查询脚本；_meta.json 只存
 * id/name 索引。脚本不含密钥，运行时由 provider 记录注入。
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { harborPaths } from "../paths/index.ts";
import type { HarborPaths } from "../paths/index.ts";
import { atomicWriteJson, NORMAL_MODE, readJson } from "../fs/index.ts";
import { getById as getProviderById } from "../providers/index.ts";

export type LimitProfilesErrorCode = "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "ARCHIVE_CORRUPT";

export class LimitProfilesError extends Error {
  readonly code: LimitProfilesErrorCode;

  constructor(code: LimitProfilesErrorCode, message: string) {
    super(message);
    this.name = "LimitProfilesError";
    this.code = code;
  }
}

export interface LimitProfile {
  readonly version: 1;
  readonly providerId: string;
  /** 用户脚本：必须定义 async function query(ctx)。 */
  readonly script: string;
  readonly timeoutMs: number;
  readonly enabled: boolean;
}

export interface LimitProfileEntry {
  readonly id: string;
  readonly name: string;
}

export interface LimitProfilesMeta {
  readonly version: 1;
  readonly entries: readonly LimitProfileEntry[];
}

export interface LimitProfilesOptions {
  readonly home?: string;
}

const UUID_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/;
const SCRIPT_MAX_LENGTH = 200_000;
const DEFAULT_TIMEOUT_MS = 8_000;

const pathCache = new Map<string, HarborPaths>();

function p(opts?: LimitProfilesOptions): HarborPaths {
  const key = opts?.home ?? "";
  const cached = pathCache.get(key);
  if (cached !== undefined) return cached;
  const paths = harborPaths(opts?.home);
  pathCache.set(key, paths);
  return paths;
}

function ensureDir(opts?: LimitProfilesOptions): string {
  const dir = p(opts).limitProfilesDir;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function asEntry(value: unknown): LimitProfileEntry | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  return { id: raw.id, name: raw.name };
}

function asProfile(value: unknown): LimitProfile | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    raw.version !== 1 ||
    typeof raw.providerId !== "string" ||
    typeof raw.script !== "string" ||
    typeof raw.timeoutMs !== "number" ||
    !Number.isFinite(raw.timeoutMs) ||
    typeof raw.enabled !== "boolean"
  ) {
    return null;
  }
  return {
    version: 1,
    providerId: raw.providerId,
    script: raw.script,
    timeoutMs: raw.timeoutMs,
    enabled: raw.enabled,
  };
}

function rebuildFromDir(opts?: LimitProfilesOptions): LimitProfilesMeta {
  let files: string[] = [];
  try {
    files = readdirSync(p(opts).limitProfilesDir);
  } catch {
    files = [];
  }
  const entries = files
    .filter((file) => UUID_FILE_PATTERN.test(file))
    .map((file) => {
      const id = file.slice(0, -".json".length);
      return { id, name: id };
    });
  return { version: 1, entries };
}

function writeMeta(entries: readonly LimitProfileEntry[], opts?: LimitProfilesOptions): void {
  ensureDir(opts);
  atomicWriteJson(p(opts).limitProfilesMeta, { version: 1, entries } as LimitProfilesMeta, NORMAL_MODE);
}

function readMeta(opts?: LimitProfilesOptions): LimitProfilesMeta {
  const file = p(opts).limitProfilesMeta;
  if (!existsSync(file)) {
    const meta = rebuildFromDir(opts);
    writeMeta(meta.entries, opts);
    return meta;
  }
  try {
    const raw = readJson(file) as Record<string, unknown>;
    if (raw === null || typeof raw !== "object" || !Array.isArray(raw.entries)) {
      throw new Error("invalid meta");
    }
    const entries = raw.entries.map(asEntry).filter((entry): entry is LimitProfileEntry => entry !== null);
    // 索引与目录对账：文件缺失/损坏的条目直接清掉，避免幽灵条目绕过“一供应商一个”。
    const valid = entries.filter((entry) => readProfileFile(entry.id, opts) !== null);
    if (valid.length !== entries.length) writeMeta(valid, opts);
    return { version: 1, entries: valid };
  } catch {
    const meta = rebuildFromDir(opts);
    writeMeta(meta.entries, opts);
    return meta;
  }
}

function readProfileFile(id: string, opts?: LimitProfilesOptions): LimitProfile | null {
  const file = join(p(opts).limitProfilesDir, `${id}.json`);
  if (!existsSync(file)) return null;
  try {
    return asProfile(readJson(file));
  } catch {
    return null;
  }
}

function validateName(name: string, entries: readonly LimitProfileEntry[], excludeId?: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    throw new LimitProfilesError("VALIDATION", "名称必须为 1–80 个字符。");
  }
  if (entries.some((entry) => entry.name === trimmed && entry.id !== excludeId)) {
    throw new LimitProfilesError("CONFLICT", `额度配置名称「${trimmed}」已存在。`);
  }
  return trimmed;
}

function validateScript(script: string): string {
  if (script.trim().length === 0) {
    throw new LimitProfilesError("VALIDATION", "脚本不能为空。");
  }
  if (script.length > SCRIPT_MAX_LENGTH) {
    throw new LimitProfilesError("VALIDATION", "脚本超过 200KB 上限。");
  }
  return script;
}

function validateTimeout(value: unknown): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new LimitProfilesError("VALIDATION", "超时必须是数字。");
  }
  return Math.min(60_000, Math.max(500, Math.trunc(value)));
}

export interface CreateLimitProfileInput {
  readonly name: string;
  readonly providerId: string;
  readonly script: string;
  readonly timeoutMs?: number;
  readonly enabled?: boolean;
}

export interface UpdateLimitProfileInput {
  readonly name?: string;
  readonly script?: string;
  readonly timeoutMs?: number;
  readonly enabled?: boolean;
}

/** 索引列表，按 _meta 顺序。 */
export function list(opts?: LimitProfilesOptions): LimitProfileEntry[] {
  return [...readMeta(opts).entries];
}

export function getById(id: string, opts?: LimitProfilesOptions): { entry: LimitProfileEntry; profile: LimitProfile } {
  const meta = readMeta(opts);
  const entry = meta.entries.find((item) => item.id === id);
  if (entry === undefined) {
    throw new LimitProfilesError("NOT_FOUND", `额度配置（${id}）不存在。`);
  }
  const profile = readProfileFile(id, opts);
  if (profile === null) {
    throw new LimitProfilesError("ARCHIVE_CORRUPT", `额度配置文件缺失或损坏：${id}.json`);
  }
  return { entry, profile };
}

/** 一供应商一个：按 providerId 找现有配置。 */
export function getByProvider(providerId: string, opts?: LimitProfilesOptions): { entry: LimitProfileEntry; profile: LimitProfile } | null {
  const meta = readMeta(opts);
  for (const entry of meta.entries) {
    const profile = readProfileFile(entry.id, opts);
    if (profile !== null && profile.providerId === providerId) {
      return { entry, profile };
    }
  }
  return null;
}

export function create(input: CreateLimitProfileInput, opts?: LimitProfilesOptions): LimitProfileEntry {
  const meta = readMeta(opts);
  const name = validateName(input.name, meta.entries);
  const script = validateScript(input.script);

  try {
    getProviderById(input.providerId, opts);
  } catch {
    throw new LimitProfilesError("VALIDATION", "绑定的供应商不存在。");
  }
  if (getByProvider(input.providerId, opts) !== null) {
    throw new LimitProfilesError("CONFLICT", "该供应商已经有额度配置，请直接编辑。");
  }

  const id = randomUUID();
  const profile: LimitProfile = {
    version: 1,
    providerId: input.providerId,
    script,
    timeoutMs: validateTimeout(input.timeoutMs),
    enabled: input.enabled !== false,
  };
  ensureDir(opts);
  atomicWriteJson(join(p(opts).limitProfilesDir, `${id}.json`), profile, NORMAL_MODE);
  writeMeta([...meta.entries, { id, name }], opts);
  return { id, name };
}

export function update(id: string, patch: UpdateLimitProfileInput, opts?: LimitProfilesOptions): LimitProfileEntry {
  const meta = readMeta(opts);
  const entry = meta.entries.find((item) => item.id === id);
  if (entry === undefined) {
    throw new LimitProfilesError("NOT_FOUND", `额度配置（${id}）不存在。`);
  }
  const current = readProfileFile(id, opts);
  if (current === null) {
    throw new LimitProfilesError("ARCHIVE_CORRUPT", `额度配置文件缺失或损坏：${id}.json`);
  }

  const name = patch.name === undefined ? entry.name : validateName(patch.name, meta.entries, id);
  const script = patch.script === undefined ? current.script : validateScript(patch.script);
  const timeoutMs = patch.timeoutMs === undefined ? current.timeoutMs : validateTimeout(patch.timeoutMs);
  const enabled = patch.enabled === undefined ? current.enabled : patch.enabled !== false;

  atomicWriteJson(
    join(p(opts).limitProfilesDir, `${id}.json`),
    { version: 1, providerId: current.providerId, script, timeoutMs, enabled } satisfies LimitProfile,
    NORMAL_MODE,
  );
  writeMeta(
    meta.entries.map((item) => (item.id === id ? { id, name } : item)),
    opts,
  );
  return { id, name };
}

export function remove(id: string, opts?: LimitProfilesOptions): void {
  const meta = readMeta(opts);
  if (!meta.entries.some((entry) => entry.id === id)) {
    throw new LimitProfilesError("NOT_FOUND", `额度配置（${id}）不存在。`);
  }
  rmSync(join(p(opts).limitProfilesDir, `${id}.json`), { force: true });
  writeMeta(meta.entries.filter((entry) => entry.id !== id), opts);
}
