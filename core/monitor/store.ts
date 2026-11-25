/**
 * Monitor Layer 1 文件原语：NDJSON 日文件、游标、原子写文本。
 *
 * 新记录写在已有内容前面，保持日文件内新到旧；日文件与游标分别原子写，
 * 游标始终最后推进。崩溃后的重复修理由用户手动全量重建承担。
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname } from "node:path";

import {
  applyFileMode,
  atomicWriteJson,
  NORMAL_MODE,
  SECRET_MODE,
} from "../archive/fs/index.ts";
import { monitorDayFile, monitorLayer1Root, monitorMetaFile } from "./paths.ts";
import { MONITOR_LEDGER_VERSION } from "./types.ts";
import type { MonitorMeta, MonitorRecord } from "./types.ts";

export class MonitorDataError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(message);
    this.name = "MonitorDataError";
    this.path = path;
  }
}

export function ensureMonitorLayer1(root: string): void {
  mkdirSync(monitorLayer1Root(root), { recursive: true, mode: 0o700 });
  applyFileMode(monitorLayer1Root(root), 0o700);
}

export function resetMonitorLayer1(root: string): void {
  rmSync(monitorLayer1Root(root), { recursive: true, force: true });
  ensureMonitorLayer1(root);
}

/** 同目录临时文件 + rename；Windows 短暂占用时有限重试。 */
function atomicWriteText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${dirname(path)}/.${basename(path)}.${process.pid}.${Math.random()
    .toString(36)
    .slice(2)}.tmp`;
  try {
    writeFileSync(tmp, text, { encoding: "utf8", mode: SECRET_MODE });
    applyFileMode(tmp, SECRET_MODE);
    const attempts = process.platform === "win32" ? 5 : 1;
    for (let index = 0; index < attempts; index += 1) {
      try {
        renameSync(tmp, path);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const retryable = code === "EPERM" || code === "EACCES" || code === "EBUSY";
        if (!retryable || index === attempts - 1) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * (index + 1));
      }
    }
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // 临时文件已不存在。
    }
    throw error;
  }
}

export function readMonitorMeta(root: string): MonitorMeta | null {
  const file = monitorMetaFile(root);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    if (
      record.v !== MONITOR_LEDGER_VERSION ||
      typeof record.ts !== "number" ||
      !Number.isFinite(record.ts) ||
      typeof record.hash !== "string" ||
      typeof record.timezone !== "string" ||
      typeof record.source !== "string"
    ) {
      return null;
    }
    return {
      v: record.v,
      ts: record.ts,
      hash: record.hash,
      timezone: record.timezone,
      source: record.source,
    };
  } catch {
    return null;
  }
}

export function writeMonitorMeta(root: string, meta: MonitorMeta): void {
  ensureMonitorLayer1(root);
  atomicWriteJson(monitorMetaFile(root), meta, NORMAL_MODE);
}

/** 原子更新一个日文件；records 必须按新到旧排列。 */
export function writeMonitorDay(
  root: string,
  dayStartTs: number,
  records: readonly MonitorRecord[],
): void {
  if (records.length === 0) return;
  ensureMonitorLayer1(root);
  const path = monitorDayFile(root, dayStartTs);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  const text = `${records.map((record) => JSON.stringify(record)).join("\n")}\n${separator}${existing}`;
  atomicWriteText(path, text);
}

/** 读取一个日文件；缺失返回 []，损坏抛 MonitorDataError。 */
export function readMonitorDay(root: string, dayStartTs: number): MonitorRecord[] {
  const path = monitorDayFile(root, dayStartTs);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const records: MonitorRecord[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new MonitorDataError("Monitor 日文件存在损坏行", path);
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new MonitorDataError("Monitor 日文件记录不是对象", path);
    }
    const value = raw as Record<string, unknown>;
    if (
      value.v !== MONITOR_LEDGER_VERSION ||
      typeof value.ts !== "number" ||
      value.provider === null ||
      typeof value.provider !== "object" ||
      value.tools === null ||
      typeof value.tools !== "object"
    ) {
      throw new MonitorDataError("Monitor 日文件记录字段不完整", path);
    }
    records.push(value as unknown as MonitorRecord);
  }
  return records;
}

/** 当前所有日文件名，按新到旧。 */
export function listMonitorDayStarts(root: string): number[] {
  const dir = monitorLayer1Root(root);
  if (!existsSync(dir)) return [];
  const days: number[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const match = /^(\d+)\.ndjson$/.exec(entry.name);
    if (match !== null) days.push(Number(match[1]));
  }
  return days.sort((a, b) => b - a);
}
