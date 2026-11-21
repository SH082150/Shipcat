/**
 * 配置生命周期：激活、状态汇总。扫描、门禁、生成器由子模块提供，本层
 * 只负责顺序与结果，CLI 与 Electron 主进程共用。
 */

import type { HarborProfile, MetaEntry, ProfilesMeta } from "../types.ts";
import { meta as profilesMeta, get as getProfile, rename as renameProfile, setAppliedIdMirror, detailList as profileDetailList } from "../archive/profiles/index.ts";
import type { ProfileListItem } from "../archive/profiles/index.ts";
import { list as listProviders } from "../archive/providers/index.ts";
import { gate, scan } from "../check/index.ts";
import type { Diff } from "../check/index.ts";
import { apply as claudeApply, read as claudeMetaRead, syncNames } from "../archive/claude-meta/index.ts";

export interface LifecycleOptions {
  readonly home?: string;
}

export type LifecycleErrorCode = "CONFLICT" | "GATE_FAILED" | "NOT_FOUND";

export class LifecycleError extends Error {
  readonly code: LifecycleErrorCode;
  readonly diffs?: readonly Diff[];

  constructor(code: LifecycleErrorCode, message: string, diffs?: readonly Diff[]) {
    super(message);
    this.name = "LifecycleError";
    this.code = code;
    if (diffs !== undefined) this.diffs = diffs;
  }
}

export interface ActivateRename {
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

export interface ActivateResult {
  readonly entry: MetaEntry;
  readonly mode: HarborProfile["mode"];
  /** 激活前的 scan 自动处置消息（可能为空）。 */
  readonly actions: readonly string[];
  /** Claude 侧名称回写本地索引的记录。 */
  readonly renames: readonly ActivateRename[];
}

function resolveEntry(meta: ProfilesMeta, idOrName: string): MetaEntry {
  const entry =
    meta.entries.find((item) => item.id === idOrName) ??
    meta.entries.find((item) => item.name === idOrName);
  if (!entry) {
    throw new LifecycleError("NOT_FOUND", `profile「${idOrName}」不存在`);
  }
  return entry;
}

/**
 * 激活 profile：scan → Claude 名称回写 → 门禁 → appliedId 指针 → 本地镜像。
 * 与 CLI 行为一致：advanced 不自动启动网关。
 */
export function activateProfile(idOrName: string, opts: LifecycleOptions = {}): ActivateResult {
  const io = opts.home === undefined ? undefined : { home: opts.home };
  let entry = resolveEntry(profilesMeta(io), idOrName);
  const profile = getProfile(entry.id, io);
  if (profile.mode === "readOnly") {
    throw new LifecycleError(
      "CONFLICT",
      `profile「${entry.name}」是只读镜像（readOnly），不可激活；想接管请删除后重新创建`,
    );
  }

  const actions = scan(io).actions.map((action) => action.message);
  entry = resolveEntry(profilesMeta(io), entry.id);

  const renames: ActivateRename[] = [];
  for (const next of syncNames(profilesMeta(io).entries, io)) {
    const old = profilesMeta(io).entries.find((item) => item.id === next.id);
    if (!old || old.name === next.name) continue;
    renameProfile(old.id, next.name, io);
    renames.push({ id: next.id, from: old.name, to: next.name });
  }

  entry = resolveEntry(profilesMeta(io), entry.id);
  const result = gate(entry.id, io);
  if (!result.ok) {
    throw new LifecycleError(
      "GATE_FAILED",
      `profile「${entry.name}」与 Claude 侧文件不一致，请先处理差异`,
      result.diffs,
    );
  }

  claudeApply(entry.id, io);
  setAppliedIdMirror(entry.id, io);
  return { entry, mode: profile.mode, actions, renames };
}

export interface StatusSnapshot {
  readonly appliedId: string | null;
  readonly claudeAppliedId: string | null;
  readonly profiles: readonly ProfileListItem[];
  readonly providers: readonly MetaEntry[];
  readonly claudeEntries: readonly MetaEntry[];
}

/** 只读状态快照：激活指针两侧 + 档案/供应商索引。不做 scan（避免读改）。 */
export function getStatus(opts: LifecycleOptions = {}): StatusSnapshot {
  const io = opts.home === undefined ? undefined : { home: opts.home };
  const local = profilesMeta(io);
  let claudeAppliedId: string | null = null;
  let claudeEntries: readonly MetaEntry[] = [];
  try {
    const claude = claudeMetaRead(io);
    claudeAppliedId = claude.appliedId;
    claudeEntries = claude.entries;
  } catch {
    // Claude 侧缺失/损坏时状态仍可展示本地部分。
  }
  return {
    appliedId: local.appliedId,
    claudeAppliedId,
    profiles: profileDetailList(io),
    providers: listProviders(io),
    claudeEntries,
  };
}
