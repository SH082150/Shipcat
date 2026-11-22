/**
 * 具名路径：用户配置、数据库与 Claude Desktop 账本来源。
 *
 * 所有路径都从 platform 层推导，不出现平台硬编码。
 */

import { basename, isAbsolute, join } from "node:path";

import {
  desktopDataRoot,
  harborRoot as platformHarborRoot,
  localAgentSessionsRoot,
  resolveHome,
} from "../platform/index.ts";
import type { PlatformOptions } from "../platform/index.ts";

/** ClaudeHarbor 自身数据根：`~/.claudeharbor`。 */
export function harborRoot(
  home: string = resolveHome(),
  opts?: PlatformOptions,
): string {
  return platformHarborRoot(home, opts);
}

/** 当前平台的 Claude Desktop 3p 数据根（`Claude-3p` 目录本身）。 */
export function claudeDesktopRoot(
  home: string = resolveHome(),
  opts?: PlatformOptions,
): string {
  return desktopDataRoot(home, opts);
}

/** ~/.claudeharbor/settings.json */
export function settingsFile(
  home: string = resolveHome(),
  opts?: PlatformOptions,
): string {
  return join(platformHarborRoot(home, opts), "settings.json");
}

/** ~/.claudeharbor/database */
export function databaseDir(
  home: string = resolveHome(),
  opts?: PlatformOptions,
): string {
  return join(platformHarborRoot(home, opts), "database");
}

/** ~/.claudeharbor/database/claudeharbor.db */
export function databaseFile(
  home: string = resolveHome(),
  opts?: PlatformOptions,
): string {
  return join(databaseDir(home, opts), "claudeharbor.db");
}

/**
 * 解析用量来源的官方账本根（`local-agent-mode-sessions`）。
 *
 * 优先级：
 * 1. settings 里指定的绝对路径（既接受 Claude-3p 根，也接受 sessions 根）；
 * 2. 环境变量 CLAUDEHARBOR_CLAUDE_ROOT（由 platform 层读取）；
 * 3. 当前平台自动探测。
 */
export function resolveUsageSourceRoot(
  root: string | null,
  home: string = resolveHome(),
  opts?: PlatformOptions,
): string {
  if (root !== null) {
    const normalized = root.trim();
    if (normalized.length > 0 && isAbsolute(normalized)) {
      return basename(normalized) === "local-agent-mode-sessions"
        ? normalized
        : join(normalized, "local-agent-mode-sessions");
    }
  }
  return localAgentSessionsRoot(home, opts);
}
