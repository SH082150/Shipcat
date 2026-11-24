/**
 * 用量服务适配层：把 core 的文件库服务接到 Electron 主进程。
 *
 * 数据只来自官方 usage-ledger：Layer 1 按本地时区切桶，Layer 2 生成
 * 固定 336 槽位的结果；渲染层只读结果，不参与聚合。
 */

import * as core from "../../../core/index.ts";
import { loadSettings } from "../../../core/settings/index.ts";
import { resolveUsageSourceRoot } from "../../../core/settings/paths.ts";
import type {
  UsageConfigDto,
  UsageSyncResultDto,
  UsageViewDto,
  UsageViewQuery,
} from "../../shared/ipc.ts";
import type { ServiceOptions } from "./providers.ts";

function usageRootOf(options: ServiceOptions): string {
  return core.usage.usageRoot(options.home);
}

/** 单账号：取第一个启用的来源；没有启用来源时停止采集。 */
function sourceRootOf(options: ServiceOptions): {
  root: string | null;
  warnings: string[];
} {
  const settings = loadSettings(options.home);
  const enabled = settings.usage.sources.filter((source) => source.enabled);
  if (enabled.length === 0) {
    return { root: null, warnings: ["未启用任何用量来源，用量采集已停止。"] };
  }
  const source = enabled[0];
  if (source === undefined) return { root: null, warnings: [] };
  const warnings =
    enabled.length > 1
      ? [`检测到 ${enabled.length} 个启用的用量来源；单账号模式下只使用第一个：${source.id}。`]
      : [];
  return { root: resolveUsageSourceRoot(source.root, options.home), warnings };
}

export function createUsageService(
  options: ServiceOptions = {},
): core.usage.UsageService {
  return new core.usage.UsageService({
    usageRoot: usageRootOf(options),
    sourceRoot: () => sourceRootOf(options),
  });
}

export function getUsageView(
  service: core.usage.UsageService,
  query?: UsageViewQuery | null,
): UsageViewDto {
  return service.getView(query ?? { heatmapRange: "30min", dailyDays: 30 });
}

export function refreshUsage(
  service: core.usage.UsageService,
): Promise<UsageSyncResultDto> {
  return service.syncNow("manual");
}

export function getUsageConfig(
  service: core.usage.UsageService,
): UsageConfigDto {
  return service.getConfig();
}

export function saveUsageConfig(
  service: core.usage.UsageService,
  value: unknown,
): UsageConfigDto {
  return service.updateConfig(value);
}
