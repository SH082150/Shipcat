/**
 * scan：对两侧 _meta 做集合比对并自动处置，一切以 Claude 侧为准。
 *
 * - 本地多出（Claude 已删除该 profile）→ 删本地 sidecar，并清除指向它的
 *   appliedId 镜像（悬空指针会让 Desktop 整体不可用）；
 * - Claude 多出（从未连接或 sidecar 遗失）→ 自动 import 建只读 sidecar；
 * - 两侧都有但 Claude profile 文件缺失 → 从 sidecar 重新推导重建。
 *
 * 返回结果携带每条处置的中文日志行，调用方原样打印。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { atomicWriteJson, SECRET_MODE } from "../archive/fs/index.ts";
import { generateDesktopProfile } from "../archive/generate/index.ts";
import { claudePaths } from "../archive/paths/index.ts";
import { read as readClaudeMeta } from "../archive/claude-meta/index.ts";
import {
  get as getProfile,
  importFromClaude,
  meta as localMeta,
  remove as removeLocal,
  setAppliedIdMirror,
} from "../archive/profiles/index.ts";
import type { MetaEntry } from "../types.ts";

export interface ScanAction {
  readonly kind: "removed" | "imported" | "import-skipped" | "file-rebuilt";
  readonly id: string;
  readonly name: string;
  readonly message: string;
}

export interface ScanResult {
  readonly actions: readonly ScanAction[];
  /** 处置后两侧已连接、可进入内容比对的条目 */
  readonly connected: readonly MetaEntry[];
}

export function scan(opts?: { home?: string }): ScanResult {
  const claude = readClaudeMeta(opts);
  const local = localMeta(opts);
  const claudeIds = new Set(claude.entries.map((e) => e.id));
  const localIds = new Set(local.entries.map((e) => e.id));
  const actions: ScanAction[] = [];

  // 本地多出（Claude 已删除该 profile）→ 自动删本地。
  for (const entry of local.entries) {
    if (claudeIds.has(entry.id)) continue;
    if (local.appliedId === entry.id) {
      setAppliedIdMirror(null, opts);
    }
    removeLocal(entry.id, opts);
    actions.push({
      kind: "removed",
      id: entry.id,
      name: entry.name,
      message: `已删除多余条目「${entry.name}」（Claude 侧已删除该 profile）`,
    });
  }

  // Claude 多出（从未连接，或 sidecar 遗失降级）→ 自动建只读 sidecar。
  // _meta 有条目但 profile 文件缺失（悬空条目）时无法导入，跳过并告警，
  // 不阻断其余条目的处置与后续激活。
  const danglingLib = claudePaths(opts?.home).configLibrary;
  for (const entry of claude.entries) {
    if (localIds.has(entry.id)) continue;
    if (!existsSync(join(danglingLib, `${entry.id}.json`))) {
      actions.push({
        kind: "import-skipped",
        id: entry.id,
        name: entry.name,
        message: `已跳过「${entry.name}」（Claude 索引存在但 profile 文件缺失，无法导入；可在 Claude Desktop 中清理该条目）`,
      });
      continue;
    }
    importFromClaude(entry.id, opts);
    actions.push({
      kind: "imported",
      id: entry.id,
      name: entry.name,
      message: `已为「${entry.name}」建立只读 sidecar（Claude 侧存在的配置）`,
    });
  }

  // 条目在两侧但 Claude 文件缺失 → 从 sidecar 重新推导重建。
  const lib = claudePaths(opts?.home).configLibrary;
  for (const entry of claude.entries) {
    if (!localIds.has(entry.id)) continue;
    const file = join(lib, `${entry.id}.json`);
    if (existsSync(file)) continue;
    // meta 先行：文件是派生物。standard 无条目时无法生成——跳过等条目补齐；
    // advanced 必然可生成，失败即真异常（拋出）。
    const rebuilt = rebuildClaudeFile(entry.id, opts);
    if (rebuilt) {
      actions.push({
        kind: "file-rebuilt",
        id: entry.id,
        name: entry.name,
        message: `已重建「${entry.name}」的 Claude profile 文件（文件缺失，_meta 条目仍在）`,
      });
    }
  }

  const connected = localMeta(opts).entries.filter((e) => claudeIds.has(e.id));
  return { actions, connected };
}

/**
 * 从 sidecar 重新推导并写入 Claude profile 文件（不动 _meta）。
 * 返回 false 表示暂不可生成（standard 无条目 / provider 缺失），调用方跳过。
 */
function rebuildClaudeFile(id: string, opts?: { home?: string }): boolean {
  const profile = getProfile(id, opts);
  if (profile.mode === "readOnly") {
    // 只读镜像的"真相"就是 Claude 文件本身，文件没了无法重建。
    throw new Error("这个只读档案对应的 Claude Desktop 配置已缺失，无法自动重建。");
  }
  let generated: Record<string, unknown>;
  try {
    generated = generateDesktopProfile(profile);
  } catch {
    return false; // standard 无条目或供应商不可解析：等条目补齐后再生成
  }
  const lib = claudePaths(opts?.home).configLibrary;
  atomicWriteJson(join(lib, `${id}.json`), generated, SECRET_MODE);
  return true;
}
