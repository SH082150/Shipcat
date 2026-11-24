/**
 * Layer 1 文件原语：cell / tpd 日文件 / `_meta_` / `_syncing_`。
 *
 * 所有写入都是同目录临时文件 + rename；损坏的 cell 抛出可识别错误，
 * 由查询层决定是否上抛，绝不静默补零。
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
import { basename, dirname, join } from "node:path";

import { applyFileMode, NORMAL_MODE, SECRET_MODE } from "../../archive/fs/index.ts";
import { atomicWriteJson } from "../../archive/fs/index.ts";
import { metaFile, syncingFile } from "./paths.ts";
import type { Layer1Cell, Layer1Meta, TpdDayCell } from "./types.ts";

export class UsageDataError extends Error {
  readonly code: string;
  readonly path: string | null;

  constructor(code: string, message: string, path: string | null = null) {
    super(message);
    this.name = "UsageDataError";
    this.code = code;
    this.path = path;
  }
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeCell(raw: unknown): Layer1Cell | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.inputTokens !== "number") return null;
  return {
    inputTokens: numberValue(record.inputTokens),
    outputTokens: numberValue(record.outputTokens),
    cacheReadTokens: numberValue(record.cacheReadTokens),
    cacheWriteTokens: numberValue(record.cacheWriteTokens),
    webSearchRequests: numberValue(record.webSearchRequests),
    cost: numberValue(record.cost),
    toolCalls: numberValue(record.toolCalls),
  };
}

function normalizeTpdDay(raw: unknown): TpdDayCell | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.chat !== "number" && typeof record.cowork !== "number" && typeof record.code !== "number") {
    return null;
  }
  return {
    chat: numberValue(record.chat),
    cowork: numberValue(record.cowork),
    code: numberValue(record.code),
  };
}

/** 原子写文本：临时文件 → chmod → rename（Windows 短暂占用重试）。 */
export function atomicWriteText(path: string, text: string, mode = SECRET_MODE): void {
  const tmp = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    writeFileSync(tmp, text, { encoding: "utf8", mode });
    applyFileMode(tmp, mode);
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

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  applyFileMode(dir, 0o700);
}

/** 删除整个目录再重建；用于整库重建。 */
export function resetDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
}

export function writeCell(path: string, cell: Layer1Cell): void {
  atomicWriteText(path, `${JSON.stringify(cell)}\n`, SECRET_MODE);
}

/** 读取单个 cell；文件不存在返回 null，损坏抛 USAGE_CELL_CORRUPT。 */
export function readCell(path: string): Layer1Cell | null {
  if (!existsSync(path)) return null;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new UsageDataError(
      "USAGE_CELL_UNREADABLE",
      `无法读取用量格子：${error instanceof Error ? error.message : String(error)}`,
      path,
    );
  }
  const line = text.split("\n").find((item) => item.trim().length > 0);
  if (line === undefined) {
    throw new UsageDataError("USAGE_CELL_CORRUPT", "用量格子为空", path);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new UsageDataError("USAGE_CELL_CORRUPT", "用量格子不是合法 JSON", path);
  }
  const cell = normalizeCell(raw);
  if (cell === null) {
    throw new UsageDataError("USAGE_CELL_CORRUPT", "用量格子字段不完整", path);
  }
  return cell;
}

export function writeTpdDay(path: string, cell: TpdDayCell): void {
  atomicWriteText(path, `${JSON.stringify(cell)}\n`, SECRET_MODE);
}

export function readTpdDay(path: string): TpdDayCell | null {
  if (!existsSync(path)) return null;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new UsageDataError(
      "USAGE_TPD_UNREADABLE",
      `无法读取按天用量：${error instanceof Error ? error.message : String(error)}`,
      path,
    );
  }
  const line = text.split("\n").find((item) => item.trim().length > 0);
  if (line === undefined) {
    throw new UsageDataError("USAGE_TPD_CORRUPT", "按天用量文件为空", path);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new UsageDataError("USAGE_TPD_CORRUPT", "按天用量文件不是合法 JSON", path);
  }
  const cell = normalizeTpdDay(raw);
  if (cell === null) {
    throw new UsageDataError("USAGE_TPD_CORRUPT", "按天用量字段不完整", path);
  }
  return cell;
}

/** 读取 `_meta_`；缺失、损坏或字段不完整一律返回 null（调用方走重建）。 */
export function readMeta(dir: string): Layer1Meta | null {
  const file = metaFile(dir);
  if (!existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.v !== "number" ||
    typeof record.ts !== "number" ||
    !Number.isFinite(record.ts) ||
    typeof record.hash !== "string"
  ) {
    return null;
  }
  return { v: record.v, ts: record.ts, hash: record.hash };
}

export function writeMeta(dir: string, meta: Layer1Meta): void {
  atomicWriteJson(metaFile(dir), meta, NORMAL_MODE);
}

export function hasSyncing(dir: string): boolean {
  return existsSync(syncingFile(dir));
}

export function markSyncing(dir: string, phase: "sync" | "rebuild"): void {
  atomicWriteJson(syncingFile(dir), { startedAt: Date.now(), phase }, NORMAL_MODE);
}

export function clearSyncing(dir: string): void {
  rmSync(syncingFile(dir), { force: true });
}

function numericFileStarts(dir: string): number[] {
  if (!existsSync(dir)) return [];
  const starts: number[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const match = /^(\d+)\.ndjson$/.exec(entry.name);
    if (match === null) continue;
    const ts = Number(match[1]);
    if (Number.isFinite(ts)) starts.push(ts);
  }
  return starts;
}

/** 目录内所有 cell 文件名对应的桶起点。 */
export function cellStarts(dir: string): number[] {
  return numericFileStarts(dir);
}

export function tpdStarts(dir: string): number[] {
  return numericFileStarts(dir);
}
