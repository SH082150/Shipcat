/**
 * 同步服务：主进程侧的计划、应用、巡检与文件监听接线。
 *
 * 只在用户确认后写入；watch 只广播“有变化”，具体差异由渲染层再取计划。
 */

import * as core from "../../../core/index.ts";

export function getSyncPlan(profileId: string): unknown {
  return core.sync.buildSyncPlan(profileId);
}

export function applySync(profileId: string, decisions: unknown): void {
  core.sync.applySyncPlan(profileId, decisions as never);
}

export function inspectProfiles(): unknown {
  return core.check.inspectClaudeChanges();
}

/** 监听 Claude 目录；返回取消函数。目录不存在时为空 watcher。 */
export function watchProfiles(onChange: () => void): () => void {
  const watcher = core.check.watchClaudeChanges({}, onChange);
  return () => watcher.close();
}
