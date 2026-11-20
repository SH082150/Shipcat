/**
 * claude-meta：对 Claude 侧 configLibrary/_meta.json 的全部读写——profile
 * 名单（entries）与激活指针（appliedId）。entries 顺序即 Claude 切换器
 * 显示顺序，新增只追加末尾；每次写盘都规范化 appliedId，保证 entries
 * 非空时它始终指向其中一条，空时记 null。
 *
 * 本模块只管 _meta.json，不创建/删除 profile 文件。
 */

import { mkdirSync } from "node:fs";

import { claudePaths } from "../paths/index.ts";
import type { ClaudePaths } from "../paths/index.ts";
import { atomicWriteJson, NORMAL_MODE, readJson } from "../fs/index.ts";
import type { MetaEntry } from "../../types.ts";

/** 调用选项：可注入 home（测试/ --home 全局选项），缺省 resolveHome()（见 core/platform）。 */
export interface ClaudeMetaOptions {
  readonly home?: string;
}

/** Claude 侧 _meta.json 的形状（appliedId + entries，无 version）。 */
export interface ClaudeMeta {
  /** 当前激活 profile 的 UUID；无激活时为 null（仅空结构）。 */
  readonly appliedId: string | null;
  /** profile 名单；顺序即 Claude 切换器显示顺序。 */
  readonly entries: readonly MetaEntry[];
}

/** 结构化错误：code 供程序判断，message 是面向用户的中文描述。 */
export type ClaudeMetaErrorCode = "NOT_FOUND";

export class ClaudeMetaError extends Error {
  readonly code: ClaudeMetaErrorCode;

  constructor(code: ClaudeMetaErrorCode, message: string) {
    super(message);
    this.name = "ClaudeMetaError";
    this.code = code;
  }
}

// ---------- 路径表 ----------

const pathCache = new Map<string, ClaudePaths>();
function p(opts?: ClaudeMetaOptions): ClaudePaths {
  const home = opts?.home;
  const key = home ?? "";
  let hit = pathCache.get(key);
  if (hit === undefined) {
    hit = claudePaths(home);
    pathCache.set(key, hit);
  }
  return hit;
}

// ---------- 读写 ----------

/** 宽松校验单条 entry，坏条目丢弃。 */
function asMetaEntry(value: unknown): MetaEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const e = value as Record<string, unknown>;
  if (typeof e.id !== "string" || typeof e.name !== "string") return null;
  return { id: e.id, name: e.name };
}

/**
 * 容错读 Claude _meta.json：不存在/损坏/形状不对都按空结构处理
 * （appliedId 记 null、entries 记空），由后续写盘重建。
 */
export function read(opts?: ClaudeMetaOptions): ClaudeMeta {
  let raw: unknown;
  try {
    raw = readJson(p(opts).meta);
  } catch {
    return { appliedId: null, entries: [] };
  }
  if (typeof raw !== "object" || raw === null) return { appliedId: null, entries: [] };
  const m = raw as Record<string, unknown>;
  if (!Array.isArray(m.entries)) return { appliedId: null, entries: [] };
  const entries = (m.entries as unknown[])
    .map(asMetaEntry)
    .filter((e): e is MetaEntry => e !== null);
  const appliedId = typeof m.appliedId === "string" ? m.appliedId : null;
  return { appliedId, entries };
}

/**
 * 写盘规范化：entries 非空时 appliedId 必须指向其中一条，否则回指第一条；
 * entries 空时记 null。
 */
function normalize(meta: ClaudeMeta): ClaudeMeta {
  const first = meta.entries[0];
  if (first === undefined) return { appliedId: null, entries: [] };
  const hit = meta.entries.some((e) => e.id === meta.appliedId);
  return {
    appliedId: hit ? meta.appliedId : first.id,
    entries: meta.entries,
  };
}

function writeMeta(meta: ClaudeMeta, opts?: ClaudeMetaOptions): void {
  const dir = p(opts).configLibrary;
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(p(opts).meta, normalize(meta), NORMAL_MODE);
}

// ---------- 公共 API ----------

/**
 * 登记 profile 条目：entries 按 id 去重更新 name（位置不动），新 id
 * 追加末尾不重排。appliedId 按规范化规则保证有指向。
 */
export function upsertEntry(entry: MetaEntry, opts?: ClaudeMetaOptions): ClaudeMeta {
  const meta = read(opts);
  const idx = meta.entries.findIndex((e) => e.id === entry.id);
  const entries = [...meta.entries];
  if (idx >= 0) {
    entries[idx] = { id: entry.id, name: entry.name };
  } else {
    entries.push({ id: entry.id, name: entry.name });
  }
  const next = normalize({ appliedId: meta.appliedId, entries });
  writeMeta(next, opts);
  return next;
}

/**
 * 移除 profile 条目：滤掉该 id，appliedId 指向它时先清 null，再按规范化
 * 写盘。调用方保证被移除的不是当前激活项。条目不存在时幂等，不写盘。
 */
export function removeEntry(id: string, opts?: ClaudeMetaOptions): ClaudeMeta {
  const meta = read(opts);
  if (!meta.entries.some((e) => e.id === id)) {
    return meta;
  }
  const entries = meta.entries.filter((e) => e.id !== id);
  const appliedId = meta.appliedId === id ? null : meta.appliedId;
  const next = normalize({ appliedId, entries });
  writeMeta(next, opts);
  return next;
}

/**
 * 切换激活：写 appliedId = 指定 id。目标不在 entries 抛 NOT_FOUND
 * （先 upsertEntry 登记再 apply）。
 */
export function apply(id: string, opts?: ClaudeMetaOptions): ClaudeMeta {
  const meta = read(opts);
  if (!meta.entries.some((e) => e.id === id)) {
    throw new ClaudeMetaError(
      "NOT_FOUND",
      `Claude _meta 里没有 profile「${id}」，无法设为激活；请先登记该条目`,
    );
  }
  const next: ClaudeMeta = { appliedId: id, entries: meta.entries };
  writeMeta(next, opts);
  return next;
}

/**
 * 改名对齐（用户在 Claude UI 改过名时以 Claude 侧为准）：比对两侧 name，
 * 返回需要回写本地索引的差异条目；Claude 侧不动。只处理两侧都有的 id。
 */
export function syncNames(ours: readonly MetaEntry[], opts?: ClaudeMetaOptions): MetaEntry[] {
  const claude = read(opts);
  const oursById = new Map(ours.map((e) => [e.id, e.name]));
  const diffs: MetaEntry[] = [];
  for (const c of claude.entries) {
    const localName = oursById.get(c.id);
    if (localName !== undefined && localName !== c.name) {
      diffs.push({ id: c.id, name: c.name });
    }
  }
  return diffs;
}
