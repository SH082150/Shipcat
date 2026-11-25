/**
 * Monitor 路径定位：所有路径都从 monitor 根或 home 推导。
 */

import { join } from "node:path";

import { harborRoot, resolveHome } from "../platform/index.ts";
import type { PlatformOptions } from "../platform/index.ts";

/** Monitor 自建文件库根：~/.claudeharbor/monitor。 */
export function monitorRoot(
  home: string = resolveHome(),
  opts?: PlatformOptions,
): string {
  return join(harborRoot(home, opts), "monitor");
}

export function monitorLayer1Root(root: string): string {
  return join(root, "layer1");
}

export function monitorLayer2Root(root: string): string {
  return join(root, "layer2");
}

export function monitorMetaFile(root: string): string {
  return join(monitorLayer1Root(root), "_meta_.json");
}

export function monitorDayFile(root: string, dayStartTs: number): string {
  return join(monitorLayer1Root(root), `${dayStartTs}.ndjson`);
}
