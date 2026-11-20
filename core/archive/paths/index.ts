/**
 * 路径定位：全项目所有路径的唯一出处。任何模块禁止自行拼路径，一律从
 * 这里取。平台差异收敛在 core/platform，本文件只把"根"拼成"表"；home
 * 可注入，便于测试。
 */

import { join } from "node:path";

import { desktopDataRoot, harborRoot, resolveHome } from "../../platform/index.ts";
import type { PlatformOptions } from "../../platform/index.ts";

/** Harbor 侧（~/.claudeharbor）的全部路径。 */
export interface HarborPaths {
  /** `~/.claudeharbor` 根目录。 */
  readonly harborHome: string;
  /** providers 目录（一家供应商一个 <UUID>.json，含密钥，权限 600）。 */
  readonly providersDir: string;
  /** profiles 目录（sidecar 底账，文件名 = ProfileID）。 */
  readonly profilesDir: string;
  /** providers/_meta.json 全路径（供应商索引）。 */
  readonly providersMeta: string;
  /** profiles/_meta.json 全路径（profile 索引 + 激活记录）。 */
  readonly profilesMeta: string;
}

/** Claude 侧（Desktop configLibrary）的全部路径。 */
export interface ClaudePaths {
  /** Claude-3p 的 configLibrary 目录（<ProfileID>.json 与 Desktop 同名）。 */
  readonly configLibrary: string;
  /** configLibrary/_meta.json 全路径（profile 名单 + appliedId）。 */
  readonly meta: string;
}

/** Harbor 侧路径表；home 缺省取 resolveHome()。纯计算，无副作用。 */
export function harborPaths(home: string = resolveHome(), opts?: PlatformOptions): HarborPaths {
  const harborHome = harborRoot(home, opts);
  const providersDir = join(harborHome, "providers");
  const profilesDir = join(harborHome, "profiles");
  return {
    harborHome,
    providersDir,
    profilesDir,
    providersMeta: join(providersDir, "_meta.json"),
    profilesMeta: join(profilesDir, "_meta.json"),
  };
}

/**
 * Claude 侧路径表；home 缺省取 resolveHome()。
 * 3p 数据根由平台层探测（macOS 固定 Application Support；Windows 安装版
 * 取 %LOCALAPPDATA%，商店版取 MSIX 包内 LocalCache）。
 */
export function claudePaths(home: string = resolveHome(), opts?: PlatformOptions): ClaudePaths {
  const configLibrary = join(desktopDataRoot(home, opts), "configLibrary");
  return {
    configLibrary,
    meta: join(configLibrary, "_meta.json"),
  };
}
