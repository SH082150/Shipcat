/**
 * apply：把需要同步页的最终值写回两端。
 *
 * 顺序：改名 → 基本信息 / 透传（一次 updateProfile）→ 模型增删改 →
 * 强制重生成 Claude 文件。这样即使用户只处理了部分行，剩余漂移也能被
 * 下一次巡检发现；不承诺跨步骤事务。
 */

import { parseClaudeValue } from "../archive/claude-block/index.ts";
import {
  addEntry,
  forceSyncProfile,
  get as getProfile,
  meta as profilesMeta,
  removeEntry,
  rename,
  replaceEntry,
  updateProfile,
} from "../archive/profiles/index.ts";
import type { ProfileEntryInput } from "../archive/profiles/index.ts";
import type { CheckOptions } from "../check/gate.ts";

export interface ModelDecision {
  /** 删除该模型（Claude 中已删除、或用户主动不要）。 */
  readonly delete?: boolean;
  /** 最终值：语义字段 → 文本；新增模型时至少要有 name/provider（advanced 还要 upstreamModel）。 */
  readonly values?: Readonly<Record<string, string>>;
}

export interface SyncDecisions {
  readonly name?: string;
  readonly port?: string;
  readonly authScheme?: string;
  readonly gatewayToken?: string;
  /** 透传键 → 最终文本；null 表示删除该键。 */
  readonly passthrough?: Readonly<Record<string, string | null>>;
  /** 模型下标 → 决策；下标以 buildSyncPlan 的 index 为准。 */
  readonly models?: Readonly<Record<number, ModelDecision>>;
}

const BOOLEAN_FIELDS = new Set(["supports1m", "prefer1m", "isFamilyDefault"]);

function entryFromValues(values: Readonly<Record<string, string>>): ProfileEntryInput {
  const entry: Record<string, unknown> = {
    name: values.name ?? "",
    provider: values.provider ?? "",
  };
  for (const [key, value] of Object.entries(values)) {
    if (key === "name" || key === "provider" || value === "") continue;
    entry[key] = BOOLEAN_FIELDS.has(key) ? value === "true" : value;
  }
  return entry as unknown as ProfileEntryInput;
}

function mergedEntry(
  previous: Record<string, unknown>,
  values: Readonly<Record<string, string>>,
): ProfileEntryInput {
  const next: Record<string, unknown> = { ...previous };
  for (const [key, value] of Object.entries(values)) {
    if (value === "") {
      delete next[key];
      continue;
    }
    next[key] = BOOLEAN_FIELDS.has(key) ? value === "true" : value;
  }
  return next as unknown as ProfileEntryInput;
}

/**
 * 应用同步决策。调用方负责把用户选择转成文本；这里只做落盘与强同步。
 * 写完后建议调用 buildSyncPlan 复核。
 */
export function applySyncPlan(
  profileId: string,
  decisions: SyncDecisions,
  opts?: CheckOptions,
): void {
  const meta = profilesMeta(opts);
  const entry =
    meta.entries.find((item) => item.id === profileId) ??
    meta.entries.find((item) => item.name === profileId);
  if (!entry) throw new Error(`profile「${profileId}」不存在`);

  let id = entry.id;

  if (typeof decisions.name === "string" && decisions.name !== entry.name) {
    rename(id, decisions.name, opts);
  }

  const before = getProfile(id, opts);

  const patch: Record<string, unknown> = {};
  if (typeof decisions.port === "string" && decisions.port !== "") {
    patch.port = Number(decisions.port);
  }
  if (typeof decisions.authScheme === "string" && decisions.authScheme !== "") {
    patch.gatewayAuthScheme = decisions.authScheme;
  }
  if (typeof decisions.gatewayToken === "string" && decisions.gatewayToken !== "") {
    patch.gatewayToken = decisions.gatewayToken;
  }

  const passthroughDecisions = decisions.passthrough ?? {};
  if (Object.keys(passthroughDecisions).length > 0) {
    const block: Record<string, unknown> = { ...(before.claude ?? {}) };
    for (const [key, value] of Object.entries(passthroughDecisions)) {
      if (value === null) {
        delete block[key];
      } else {
        block[key] = parseClaudeValue(value);
      }
    }
    patch.claude = Object.keys(block).length === 0 ? null : block;
  }

  if (Object.keys(patch).length > 0) {
    updateProfile(id, patch as never, opts);
  }

  const modelDecisions = decisions.models ?? {};
  const originals = [...getProfile(id, opts).inferenceModels] as unknown as Record<string, unknown>[];
  const standardProvider =
    typeof originals[0]?.provider === "string" ? String(originals[0].provider) : "";

  for (const [rawIndex, decision] of Object.entries(modelDecisions)) {
    const index = Number(rawIndex);
    const previous = originals[index];
    if (previous === undefined) continue;

    if (decision.delete) {
      removeEntry(id, { name: String(previous.name) } as never, opts);
      continue;
    }
    if (decision.values === undefined) continue;
    replaceEntry(id, String(previous.name), mergedEntry(previous, decision.values), opts);
  }

  const additions = Object.entries(modelDecisions)
    .map(([rawIndex, decision]) => ({ index: Number(rawIndex), decision }))
    .filter(({ index, decision }) => index >= originals.length && !decision.delete && decision.values !== undefined)
    .sort((a, b) => a.index - b.index);

  for (const { decision } of additions) {
    const values = { ...(decision.values ?? {}) };
    if (values.provider === undefined || values.provider === "") {
      values.provider = standardProvider;
    }
    addEntry(id, entryFromValues(values), opts);
  }

  forceSyncProfile(id, opts);
}
