/**
 * Monitor 模型归属：appliedId → 同 UUID sidecar → provider + upstreamModel。
 *
 * 每轮同步只读取一次当前档案；同一批记录共用该映射。无法确认的模型统一
 * 汇总到 unknown.unknown，绝不因归属失败而丢弃 token。
 */

import { read as readClaudeMeta } from "../archive/claude-meta/index.ts";
import { get as getProfile } from "../archive/profiles/index.ts";
import type { AdvancedModelEntry, HarborProfile } from "../types.ts";
import type { OfficialMonitorEntry } from "./ledger.ts";
import { UNKNOWN_MODEL, UNKNOWN_PROVIDER } from "./types.ts";
import type { MonitorProviderUsage, MonitorTokenUsage } from "./types.ts";

export function activeMonitorProfile(home?: string, clientRunning = true): HarborProfile | null {
  if (!clientRunning) return null;
  try {
    const appliedId = readClaudeMeta(home === undefined ? undefined : { home }).appliedId;
    if (appliedId === null) return null;
    return getProfile(appliedId, home === undefined ? undefined : { home });
  } catch {
    return null;
  }
}

function emptyUsage(): MonitorTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    webSearchRequests: 0,
  };
}

function addUsage(target: MonitorTokenUsage, source: MonitorTokenUsage): MonitorTokenUsage {
  return {
    inputTokens: target.inputTokens + source.inputTokens,
    outputTokens: target.outputTokens + source.outputTokens,
    cacheReadTokens: target.cacheReadTokens + source.cacheReadTokens,
    cacheWriteTokens: target.cacheWriteTokens + source.cacheWriteTokens,
    webSearchRequests: target.webSearchRequests + source.webSearchRequests,
  };
}

/** 把官方 models 转成 provider → upstreamModel；同一路径相加，未解析部分合并。 */
export function groupMonitorModels(
  models: OfficialMonitorEntry["models"],
  profile: HarborProfile | null,
): MonitorProviderUsage {
  const grouped = new Map<string, Map<string, MonitorTokenUsage>>();

  const add = (provider: string, model: string, usage: MonitorTokenUsage): void => {
    const byModel = grouped.get(provider) ?? new Map<string, MonitorTokenUsage>();
    byModel.set(model, addUsage(byModel.get(model) ?? emptyUsage(), usage));
    grouped.set(provider, byModel);
  };

  const routes = new Map<string, { provider: string; upstreamModel: string }>();
  if (profile !== null && profile.mode !== "readOnly") {
    for (const entry of profile.inferenceModels) {
      if (typeof entry.name !== "string" || typeof entry.provider !== "string") continue;
      const upstreamModel =
        profile.mode === "advanced"
          ? (entry as AdvancedModelEntry).upstreamModel
          : entry.name;
      if (typeof upstreamModel !== "string" || upstreamModel.length === 0) continue;
      routes.set(entry.name, { provider: entry.provider, upstreamModel });
    }
  }

  for (const [officialModel, usage] of Object.entries(models)) {
    const route = routes.get(officialModel);
    if (route === undefined) {
      add(UNKNOWN_PROVIDER, UNKNOWN_MODEL, usage);
    } else {
      add(route.provider, route.upstreamModel, usage);
    }
  }

  if (grouped.size === 0) {
    add(UNKNOWN_PROVIDER, UNKNOWN_MODEL, emptyUsage());
  }

  return Object.fromEntries(
    [...grouped].map(([provider, byModel]) => [provider, Object.fromEntries(byModel)]),
  );
}
