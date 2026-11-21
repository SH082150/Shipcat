/**
 * check：一致性检查的统一出口。
 *
 * - gate：字段级门禁，activate / 起网关前必须通过；
 * - scan：两侧名单比对与自动处置（增删/导入/重建）；
 * - inspect：只读巡检，列出 Claude 侧漂移的档案，不写文件；
 * - watch：监听 Claude 目录变化，事件合并后通知调用方去 inspect。
 */

export { CheckError, compareProfile, gate } from "./gate.ts";
export type {
  CheckErrorCode,
  CheckOptions,
  Diff,
  GateResult,
  ProfileComparison,
} from "./gate.ts";

export { inspectClaudeChanges } from "./inspect.ts";
export type { ClaudeDriftReport, ProfileDrift } from "./inspect.ts";

export { scan } from "./scan.ts";
export type { ScanAction, ScanResult } from "./scan.ts";

export { DEFAULT_WATCH_DEBOUNCE_MS, watchClaudeChanges } from "./watch.ts";
export type { ClaudeWatcher, WatchOptions } from "./watch.ts";
