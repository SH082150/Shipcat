/**
 * Layer 1 / Layer 2 的路径布局，全部由 `<usage-root>` 推导。
 */

import { join } from "node:path";

import type { Layer1Level } from "../time.ts";
import type { TpdRange } from "./types.ts";

export function layer1Root(root: string): string {
  return join(root, "layer1");
}

export function layer2Root(root: string): string {
  return join(root, "layer2");
}

export function levelDir(root: string, level: Layer1Level): string {
  return join(layer1Root(root), level);
}

export function tpdDir(root: string, range: TpdRange): string {
  return join(layer1Root(root), `tp${range}d`);
}

export function layer2LevelDir(root: string, level: Layer1Level): string {
  return join(layer2Root(root), level);
}

export function cellFileName(ts: number): string {
  return `${ts}.ndjson`;
}

export function cellFile(root: string, level: Layer1Level, ts: number): string {
  return join(levelDir(root, level), cellFileName(ts));
}

export function tpdFile(root: string, range: TpdRange, ts: number): string {
  return join(tpdDir(root, range), cellFileName(ts));
}

export function metaFile(dir: string): string {
  return join(dir, "_meta_.json");
}

export function syncingFile(dir: string): string {
  return join(dir, "_syncing_");
}

export function layer2File(root: string, level: Layer1Level): string {
  return join(layer2LevelDir(root, level), "cells.json");
}
