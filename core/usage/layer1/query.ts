/**
 * Layer 1 查询接口：按 ts 读单格、读整个窗口、读 tpd 范围。
 *
 * 缺失的桶按零处理；已有文件损坏则抛错，不静默补零。UI 不直接读文件。
 */

import { formatLocalDay, windowStarts } from "../time.ts";
import type { Layer1Level } from "../time.ts";
import { cellFile, levelDir, metaFile, tpdFile } from "./paths.ts";
import { readCell, readMeta, readTpdDay } from "./store.ts";
import { emptyCell, emptyTpdDay } from "./types.ts";
import type { Layer1Cell, Layer1Meta, Layer1Point, TpdPoint, TpdRange } from "./types.ts";

export function readCellAt(
  root: string,
  level: Layer1Level,
  ts: number,
): Layer1Cell | null {
  return readCell(cellFile(root, level, ts));
}

/** 当前窗口，索引 0 = 最新；缺失文件返回零值 cell。 */
export function readLevelWindow(
  root: string,
  level: Layer1Level,
  timezone: string,
  now: number,
  count = 336,
): Layer1Point[] {
  return windowStarts(level, now, timezone, count).map((ts) => ({
    ts,
    cell: readCell(cellFile(root, level, ts)) ?? emptyCell(),
  }));
}

/** tpd 范围：由远到近，缺失日补零。 */
export function readTpdWindow(
  root: string,
  range: TpdRange,
  timezone: string,
  now: number,
): TpdPoint[] {
  const starts = windowStarts("1d", now, timezone, range);
  return starts
    .slice()
    .reverse()
    .map((ts) => ({
      ts,
      day: formatLocalDay(ts, timezone),
      cell: readTpdDay(tpdFile(root, range, ts)) ?? emptyTpdDay(),
    }));
}

/** 读 `_meta_`；缺失或损坏返回 null。热力图库与 tpd 目录都适用。 */
export function readLayerMeta(dir: string): Layer1Meta | null {
  return readMeta(dir);
}

export function levelMetaPath(root: string, level: Layer1Level): string {
  return metaFile(levelDir(root, level));
}
