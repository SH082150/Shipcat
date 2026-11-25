/**
 * Monitor 读取：按日文件由新到旧取最近记录，供 UI 打开时回填历史。
 *
 * 旧文件没有 `id` 时用内容哈希补一个稳定标识，保证与实时事件去重。
 */

import { createHash } from "node:crypto";

import { listMonitorDayStarts, readMonitorDay } from "./store.ts";
import type { MonitorRecord } from "./types.ts";

function stableId(record: MonitorRecord): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

/** 最近 limit 条记录，按时间从旧到新返回（UI 逐条前插得到最新在上）。 */
export function readRecentMonitorRecords(root: string, limit = 500): MonitorRecord[] {
  const days = listMonitorDayStarts(root);
  const collected: MonitorRecord[] = [];
  for (const day of days) {
    let records: MonitorRecord[];
    try {
      records = readMonitorDay(root, day);
    } catch (error) {
      console.error(`Failed to read monitor day ${day}:`, error);
      continue;
    }
    // 日文件内已是新到旧；直接追加即可保持整体从新到旧。
    collected.push(...records);
    if (collected.length >= limit) break;
  }
  return collected
    .slice(0, limit)
    .map((record) => ({ ...record, id: record.id ?? stableId(record) }))
    .reverse();
}
