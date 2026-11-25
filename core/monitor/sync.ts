/**
 * Monitor Layer 1 同步：ts 优先、同 ts 才比较 hash；日文件先于游标完成。
 */

import { localDayStart } from "../usage/time.ts";
import type { HarborProfile } from "../types.ts";
import { createMonitorScanStats, monitorLineHash, scanMonitorLedger } from "./ledger.ts";
import { groupMonitorModels } from "./profile.ts";
import {
  listMonitorDayStarts,
  readMonitorMeta,
  resetMonitorLayer1,
  writeMonitorDay,
  writeMonitorMeta,
} from "./store.ts";
import { MONITOR_LEDGER_VERSION } from "./types.ts";
import type { MonitorRecord, MonitorRecordEvent, MonitorScanStats } from "./types.ts";

export interface MonitorLayer1SyncOptions {
  readonly root: string;
  readonly sourceRoot: string;
  /** usage 配置里的 IANA 时区；决定日文件归属与窗口语义。 */
  readonly timeZone: string;
  /** 本批次共用的当前档案；null 表示全部 unknown。 */
  readonly profile: HarborProfile | null;
  /** 用户手动全量重建：清空现有记录，全部供应商/模型归为 unknown。 */
  readonly rebuild?: boolean;
  /** 提交成功后按旧到新逐条通知；rebuild 不通知。 */
  readonly onRecord?: (event: MonitorRecordEvent) => void;
  readonly now?: () => number;
}

export interface MonitorLayer1SyncResult extends MonitorScanStats {
  readonly rebuilt: boolean;
  readonly lastSyncAt: number;
  readonly warnings: readonly string[];
}

export function syncMonitorLayer1(options: MonitorLayer1SyncOptions): MonitorLayer1SyncResult {
  const rebuilt = options.rebuild === true;
  if (rebuilt) resetMonitorLayer1(options.root);

  const stats = createMonitorScanStats();
  let meta = rebuilt ? null : readMonitorMeta(options.root);

  // 时区、账本来源变化，或旧版本数据（v1 的 ts 带固定偏移）无法续写：整库重建。
  if (
    meta !== null &&
    (meta.timezone !== options.timeZone || meta.source !== options.sourceRoot)
  ) {
    resetMonitorLayer1(options.root);
    meta = null;
  } else if (
    meta === null &&
    !rebuilt &&
    listMonitorDayStarts(options.root).length > 0
  ) {
    resetMonitorLayer1(options.root);
  }
  const byDay = new Map<number, MonitorRecord[]>();
  const events: MonitorRecordEvent[] = [];
  let newest: { sourceTs: number; hash: string } | null = null;

  for (const entry of scanMonitorLedger(options.sourceRoot, stats)) {
    const lineHash = monitorLineHash(entry.rawLine);
    if (meta !== null) {
      // 早于游标的记录已处理过。不能 break：多账本目录或旧日文件迟到追加的
      // 新记录可能出现在更旧的 ts 之后，提前结束会永久漏读。
      if (entry.sourceTs < meta.ts) continue;
      // 找到游标行本身：其余同 ts 记录已在其前后处理完毕。
      if (entry.sourceTs === meta.ts && lineHash === meta.hash) break;
    }

    const eventId = monitorLineHash(`${entry.sourceRel}\u0000${entry.lineNo}\u0000${entry.rawLine}`);
    const record: MonitorRecord = {
      v: MONITOR_LEDGER_VERSION,
      id: eventId,
      ts: entry.sourceTs,
      surface: entry.surface,
      origin: entry.origin,
      sessionId: entry.sessionId,
      isError: entry.isError,
      provider: groupMonitorModels(entry.models, rebuilt ? null : options.profile),
      tools: entry.tools,
    };
    if (!rebuilt) {
      events.push({
        ...record,
        eventId,
        sourceTs: entry.sourceTs,
        sourceRel: entry.sourceRel,
        lineNo: entry.lineNo,
        rawLine: entry.rawLine,
      });
    }
    const day = localDayStart(record.ts, options.timeZone);
    const records = byDay.get(day) ?? [];
    records.push(record);
    byDay.set(day, records);
    stats.recordsProcessed += 1;
    // 游标必须取本轮最大 ts；首个处理到的记录不一定最新（跨账本目录时）。
    if (newest === null || entry.sourceTs > newest.sourceTs) {
      newest = { sourceTs: entry.sourceTs, hash: lineHash };
    }
  }

  // 日文件按新到旧写入；游标永远最后推进。
  for (const day of [...byDay.keys()].sort((a, b) => b - a)) {
    writeMonitorDay(options.root, day, byDay.get(day) ?? []);
  }

  if (newest !== null) {
    writeMonitorMeta(options.root, {
      v: MONITOR_LEDGER_VERSION,
      ts: newest.sourceTs,
      hash: newest.hash,
      timezone: options.timeZone,
      source: options.sourceRoot,
    });
  } else if (meta === null) {
    writeMonitorMeta(options.root, {
      v: MONITOR_LEDGER_VERSION,
      ts: 0,
      hash: "",
      timezone: options.timeZone,
      source: options.sourceRoot,
    });
  }

  // 全部写盘成功后才发布；扫描为新到旧，发布前反转为旧到新。
  if (!rebuilt && options.onRecord !== undefined) {
    for (const event of events.reverse()) {
      try {
        options.onRecord(event);
      } catch (error) {
        console.error("Monitor onRecord listener failed:", error);
      }
    }
  }

  const warnings = Object.entries(stats.unknownVersions).map(
    ([version, count]) => `发现未知账本版本 v=${version}（${count} 行已跳过）`,
  );

  return {
    ...stats,
    rebuilt,
    lastSyncAt: (options.now ?? (() => Date.now()))(),
    warnings,
  };
}
