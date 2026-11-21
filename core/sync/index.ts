/**
 * sync：双端同步的只读计划与用户确认后的落盘。
 *
 * - buildSyncPlan：把漂移翻译成 基本信息 / 模型 / 透传 三类可渲染项；
 * - applySyncPlan：按最终值改 sidecar，然后强制重生成 Claude 文件。
 */

export { buildSyncPlan, planHasDrift } from "./plan.ts";
export type {
  SyncCategory,
  SyncField,
  SyncKind,
  SyncModel,
  SyncPlan,
  SyncValue,
} from "./plan.ts";

export { applySyncPlan } from "./apply.ts";
export type { ModelDecision, SyncDecisions } from "./apply.ts";
