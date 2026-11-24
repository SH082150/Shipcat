/**
 * Layer 2 构建：读 Layer 1 当前窗口，算 total / level / display，原子写
 * `layer2/<粒度>/cells.json`。
 *
 * 不存单格明细：`ts[i]` 是悬停时回 Layer 1 取卡片的指针。
 */

import { atomicWriteJson, NORMAL_MODE } from "../../archive/fs/index.ts";
import type { Layer1Level } from "../time.ts";
import { formatBucketStart, formatLocalSecond } from "../time.ts";
import { readLevelWindow } from "../layer1/query.ts";
import { CELL_COUNT, cellValue } from "../layer1/types.ts";
import type { Layer1Cell } from "../layer1/types.ts";
import { layer2File } from "../layer1/paths.ts";
import { ensureDir } from "../layer1/store.ts";
import type { Layer2Snapshot, Layer2Total } from "./types.ts";
import { dirname } from "node:path";

export interface BuildLayer2Options {
  readonly root: string;
  readonly level: Layer1Level;
  readonly timezone: string;
  /** 注入“现在”，UTC epoch 毫秒。 */
  readonly now: number;
  readonly count?: number;
}

function totalOf(cells: readonly Layer1Cell[]): Layer2Total {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let toolCalls = 0;
  let webSearchRequests = 0;
  for (const cell of cells) {
    inputTokens += cell.inputTokens;
    outputTokens += cell.outputTokens;
    cacheReadTokens += cell.cacheReadTokens;
    cacheWriteTokens += cell.cacheWriteTokens;
    toolCalls += cell.toolCalls;
    webSearchRequests += cell.webSearchRequests;
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    toolCalls,
    webSearchRequests,
  };
}

function levelFor(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4))) as 1 | 2 | 3 | 4;
}

export function buildLayer2(options: BuildLayer2Options): Layer2Snapshot {
  const { root, level, timezone, now } = options;
  const count = options.count ?? CELL_COUNT;
  const points = readLevelWindow(root, level, timezone, now, count);
  const cells = points.map((point) => point.cell);
  const max = Math.max(0, ...cells.map(cellValue));

  const snapshot: Layer2Snapshot = {
    lastSyncAt: now,
    lastSyncDisplay: formatLocalSecond(now, timezone),
    total: totalOf(cells),
    ts: points.map((point) => point.ts),
    display: points.map((point) => formatBucketStart(point.ts, level, timezone)),
    level: cells.map((cell) => levelFor(cellValue(cell), max)),
  };

  const file = layer2File(root, level);
  ensureDir(dirname(file));
  atomicWriteJson(file, snapshot, NORMAL_MODE);
  return snapshot;
}
