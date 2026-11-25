/**
 * Monitor 服务适配层：把 core 的记录级文件库接到主进程。
 *
 * 与用量共用官方 usage-ledger 来源，但游标、数据库和订阅完全独立；
 * 渲染层只读主进程推送的记录，不直接访问文件。
 */

import * as core from "../../../core/index.ts";
import { loadSettings } from "../../../core/settings/index.ts";
import { resolveUsageSourceRoot } from "../../../core/settings/paths.ts";
import type { ServiceOptions } from "./providers.ts";

function sourceRootOf(options: ServiceOptions): {
  root: string | null;
  warnings: string[];
} {
  const settings = loadSettings(options.home);
  const enabled = settings.usage.sources.filter((source) => source.enabled);
  if (enabled.length === 0) {
    return { root: null, warnings: ["未启用任何用量来源，Monitor 采集已停止。"] };
  }
  const source = enabled[0];
  if (source === undefined) return { root: null, warnings: [] };
  const warnings =
    enabled.length > 1
      ? [`检测到 ${enabled.length} 个启用的用量来源；Monitor 只使用第一个：${source.id}。`]
      : [];
  return { root: resolveUsageSourceRoot(source.root, options.home), warnings };
}

export function createMonitorService(
  options: ServiceOptions = {},
): core.monitor.MonitorService {
  return new core.monitor.MonitorService({
    monitorRoot: core.monitor.monitorRoot(options.home),
    sourceRoot: () => sourceRootOf(options),
    home: options.home,
    clientRunning: () => true,
  });
}
