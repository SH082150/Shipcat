/**
 * inspect：只读巡检。对每个本地 profile 做字段级比对，列出 Claude 侧
 * 已漂移（值变了 / 文件缺失 / 多出顶层键）的档案；不写文件、不处理名单
 * ——名单的自动处置仍归 scan。
 *
 * 用途：文件监听或界面刷新时判断"哪些档案需要用户检查"，与 activate /
 * 网关门禁解耦。readOnly 镜像没有期望配置，跳过。
 */

import { syncNames } from "../archive/claude-meta/index.ts";
import { get as getProfile, meta as profilesMeta } from "../archive/profiles/index.ts";
import { CheckError, compareProfile } from "./gate.ts";
import type { CheckOptions, Diff } from "./gate.ts";

/** 单个档案的漂移描述。 */
export interface ProfileDrift {
  readonly id: string;
  readonly name: string;
  readonly mode: string;
  /** 字段差异（Claude 值与本地期望不一致或缺失）。 */
  readonly diffs: readonly Diff[];
  /** Claude 文件里有、期望配置里没有的顶层键（新增的透传项等）。 */
  readonly extraKeys: readonly string[];
  /** 无法比对时的原因（文件损坏、本地配置缺供应商等）。 */
  readonly error?: string;
}

/** 一次巡检的完整结果。 */
export interface ClaudeDriftReport {
  /** 只包含有漂移或错误的档案；无漂移时为空数组。 */
  readonly profiles: readonly ProfileDrift[];
  /** Claude 侧改过名、尚未回写本地的条目。 */
  readonly renames: readonly {
    readonly id: string;
    readonly from: string;
    readonly to: string;
  }[];
}

/**
 * 巡检 Claude 侧配置：只读，不触发 scan 的增删/重建。
 * 任何写操作（导入、覆盖）都由调用方在用户确认后另行执行。
 */
export function inspectClaudeChanges(opts?: CheckOptions): ClaudeDriftReport {
  const meta = profilesMeta(opts);
  const profiles: ProfileDrift[] = [];

  for (const entry of meta.entries) {
    let mode: string;
    try {
      mode = getProfile(entry.id, opts).mode;
    } catch (err) {
      profiles.push({
        id: entry.id,
        name: entry.name,
        mode: "unknown",
        diffs: [],
        extraKeys: [],
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (mode === "readOnly") continue;

    try {
      const { diffs, extraKeys } = compareProfile(entry.id, opts);
      if (diffs.length > 0 || extraKeys.length > 0) {
        profiles.push({ id: entry.id, name: entry.name, mode, diffs, extraKeys });
      }
    } catch (err) {
      profiles.push({
        id: entry.id,
        name: entry.name,
        mode,
        diffs: [],
        extraKeys: [],
        error:
          err instanceof CheckError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err),
      });
    }
  }

  const renames = syncNames(meta.entries, opts).flatMap((next) => {
    const old = meta.entries.find((entry) => entry.id === next.id);
    if (!old || old.name === next.name) return [];
    return [{ id: next.id, from: old.name, to: next.name }];
  });

  return { profiles, renames };
}
