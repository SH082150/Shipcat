/** Monitor 公共出口：官方账本的记录级文件数据库与持续同步。 */

export * from "./types.ts";
export {
  monitorRoot,
  monitorLayer1Root,
  monitorLayer2Root,
  monitorMetaFile,
  monitorDayFile,
} from "./paths.ts";
export {
  scanMonitorLedger,
  createMonitorScanStats,
  monitorLineHash,
} from "./ledger.ts";
export type { OfficialMonitorEntry } from "./ledger.ts";
export { activeMonitorProfile, groupMonitorModels } from "./profile.ts";
export {
  MonitorDataError,
  readMonitorMeta,
  writeMonitorMeta,
  readMonitorDay,
  writeMonitorDay,
  listMonitorDayStarts,
  resetMonitorLayer1,
} from "./store.ts";
export { syncMonitorLayer1 } from "./sync.ts";
export { readRecentMonitorRecords } from "./query.ts";
export type { MonitorLayer1SyncOptions, MonitorLayer1SyncResult } from "./sync.ts";
export { MonitorService } from "./service.ts";
export type {
  MonitorLifecycleState,
  MonitorServiceOptions,
  MonitorSourceResolution,
} from "./service.ts";
