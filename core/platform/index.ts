/**
 * 平台层：全项目唯一的平台差异出处（macOS / Windows / Linux）。
 *
 * 任何模块禁止出现 `process.platform` 判断或硬编码的平台路径片段；本层
 * 只做路径计算 + 存在性探测。home、platform、env 均可注入，测试不读
 * 真实环境变量。
 *
 * Windows 的 Claude Desktop 有两套安装形态，数据根不同：
 * - 安装版（Squirrel/NSIS）：`%LOCALAPPDATA%\Claude-3p`，真机实测的主位置，
 *   `configLibrary`、`local-agent-mode-sessions` 都在这里。
 * - 商店版（MSIX）：`%LOCALAPPDATA%\Packages\<Claude 包名>\LocalCache\
 *   Roaming\Claude-3p`。包名带随机后缀（每台机器不同），随版本/重装变化，
 *   **禁止硬编码**，只能扫描 `Packages` 下 `Claude*` 目录。
 *
 * `%APPDATA%\Claude-3p` 也常被创建，但可能只有壳数据，因此候选之间按
 * "是否含真实数据目录"打分，而不是先到先得。
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** 可注入的平台上下文；缺省取当前进程的 platform / env。 */
export interface PlatformOptions {
  /** 目标平台，取值同 `process.platform`（"darwin" | "win32" | "linux" …）。 */
  readonly platform?: string;
  /** 环境变量表；缺省 `process.env`。测试注入假 env，禁止读真实环境。 */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** 环境变量覆盖：手工指定 Claude 3p 数据根（CLI `--claude-root` / UI 输入框）。 */
export const CLAUDE_ROOT_ENV = "CLAUDEHARBOR_CLAUDE_ROOT";

/** 环境变量覆盖：手工指定用户主目录（CLI `--home` / UI 隔离环境）。 */
export const HOME_ENV = "CLAUDEHARBOR_HOME";

/** 平台名（"darwin" | "win32" | "linux" …），可由入参注入。 */
export function platformOf(opts?: PlatformOptions): string {
  return opts?.platform ?? process.platform;
}

/** 环境变量表，可由入参注入。 */
export function envOf(opts?: PlatformOptions): Readonly<Record<string, string | undefined>> {
  return opts?.env ?? process.env;
}

/**
 * 用户主目录：
 * 1. `CLAUDEHARBOR_HOME`（CLI `--home` / UI 显式注入，优先级最高）；
 * 2. Windows 取 `USERPROFILE`（Git Bash 会把 `HOME` 改写成 `/c/Users/…`
 *    这种 POSIX 写法，直接拿去拼 Windows 路径会出错）；
 * 3. macOS / Linux 取 `HOME`；
 * 4. 最后回退 `os.homedir()`。
 */
export function resolveHome(opts?: PlatformOptions): string {
  const env = envOf(opts);
  const explicit = env[HOME_ENV];
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const preferred = platformOf(opts) === "win32" ? env.USERPROFILE : env.HOME;
  if (preferred !== undefined && preferred.length > 0) return preferred;
  const fallback = platformOf(opts) === "win32" ? env.HOME : env.USERPROFILE;
  if (fallback !== undefined && fallback.length > 0) return fallback;
  return homedir();
}

/**
 * ClaudeHarbor 自身数据根：`~/.claudeharbor`。
 * 两个平台都保留点目录命名与同一层级（跨平台一致，便于文档与迁移）。
 */
export function harborRoot(home: string = resolveHome(), _opts?: PlatformOptions): string {
  return join(home, ".claudeharbor");
}

/**
 * Claude Code 配置根：`~/.claude`。与该目录无关的文件归 Claude Code 所有；
 * 本层只提供位置，核心流程不读写它。
 */
export function claudeCodeRoot(home: string = resolveHome(), _opts?: PlatformOptions): string {
  return join(home, ".claude");
}

/** macOS 的 Application Support 目录（`~/Library/Application Support`）。 */
function macSupportDir(home: string): string {
  return join(home, "Library", "Application Support");
}

/** 规范化路径用于比较（Windows 不区分大小写，分隔符统一）。 */
function samePath(a: string, b: string): boolean {
  const norm = (value: string) => value.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * 判断注入的 home 是否就是当前用户的真实主目录。
 *
 * 只有"真实主目录"才允许采用系统环境变量（`%LOCALAPPDATA%`/`%APPDATA%`）——
 * 它们可能被组策略重定向到别的盘。一旦 home 是被注入的（CLI `--home`、
 * 测试临时目录、Electron 的隔离环境），所有 AppData 派生路径必须
 * 跟注入的 home 走，否则测试会写到真实用户的 Claude 目录去。
 */
function isRealHome(
  home: string,
  env: Readonly<Record<string, string | undefined>>,
  platform: string,
): boolean {
  const realHome = env.USERPROFILE ?? (platform === "win32" ? homedir() : undefined);
  if (realHome === undefined || realHome.length === 0) return false;
  return samePath(home, realHome);
}

/** `home` 下的 AppData 子目录（`Local` 或 `Roaming`）。 */
function homeAppData(home: string, tail: "Local" | "Roaming"): string {
  return join(home, "AppData", tail);
}

/** Windows 的 `%LOCALAPPDATA%`；非真实主目录或 env 缺失时从 home 推。 */
function windowsLocalAppData(
  home: string,
  env: Readonly<Record<string, string | undefined>>,
  platform: string,
): string {
  const value = env.LOCALAPPDATA;
  if (value !== undefined && value.length > 0 && isRealHome(home, env, platform)) return value;
  return homeAppData(home, "Local");
}

/** Windows 的 `%APPDATA%`；非真实主目录或 env 缺失时从 home 推。 */
function windowsRoamingAppData(
  home: string,
  env: Readonly<Record<string, string | undefined>>,
  platform: string,
): string {
  const value = env.APPDATA;
  if (value !== undefined && value.length > 0 && isRealHome(home, env, platform)) return value;
  return homeAppData(home, "Roaming");
}

/** Linux 配置根：`XDG_CONFIG_HOME`（必须绝对路径）否则 `~/.config`。 */
function linuxConfigDir(home: string, env: Readonly<Record<string, string | undefined>>): string {
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg !== undefined && xdg.length > 0 && isAbsolute(xdg)) return xdg;
  return join(home, ".config");
}

/** 目录存在则列出子目录名（排序稳定）；不可读时返回空数组。 */
function subdirNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Windows 的 Claude-3p 数据根候选，按优先级排列（去重、顺序稳定）：
 * 1. `%LOCALAPPDATA%\Claude-3p`（安装版主位置）；
 * 2. `%APPDATA%\Claude-3p`（部分版本把壳数据放这里）；
 * 3. `%LOCALAPPDATA%\Packages\Claude*\LocalCache\Roaming\Claude-3p`（MSIX）；
 * 4. `%LOCALAPPDATA%` 下其它 `Claude*-3p` 目录（测试版/重命名安装）。
 */
export function desktopDataRootCandidates(
  home: string = resolveHome(),
  opts?: PlatformOptions,
): string[] {
  const env = envOf(opts);
  const platform = platformOf(opts);

  const explicit = env[CLAUDE_ROOT_ENV];
  if (explicit !== undefined && explicit.length > 0) return [explicit];

  if (platform === "darwin") {
    return [join(macSupportDir(home), "Claude-3p")];
  }

  if (platform === "linux") {
    return [join(linuxConfigDir(home, env), "Claude-3p")];
  }

  if (platform !== "win32") {
    // 其它平台：仅给一个可预期的位置，不做探测。
    return [join(macSupportDir(home), "Claude-3p")];
  }

  const localAppData = windowsLocalAppData(home, env, platform);
  const candidates: string[] = [
    join(localAppData, "Claude-3p"),
    join(windowsRoamingAppData(home, env, platform), "Claude-3p"),
  ];

  // MSIX：包名带随机后缀，只能扫描。
  const packages = join(localAppData, "Packages");
  for (const pkg of subdirNames(packages)) {
    if (!/^claude/i.test(pkg)) continue;
    candidates.push(join(packages, pkg, "LocalCache", "Roaming", "Claude-3p"));
  }

  // 同级变体：Claude-3p-beta 之类，避免只认死一个名字。
  for (const name of subdirNames(localAppData)) {
    if (!/^claude/i.test(name) || !/-3p/i.test(name)) continue;
    if (name.toLowerCase() === "claude-3p") continue;
    candidates.push(join(localAppData, name));
  }

  return dedupe(candidates);
}

/** 按顺序去重（大小写不敏感，Windows 路径不区分大小写）。 */
function dedupe(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}

/**
 * 在候选中挑第一个含指定标记子目录的；都不含时退回第一个存在的；
 * 都不存在时退回首个候选（让上层保持"目录不存在"的既有行为）。
 */
function pickRoot(candidates: readonly string[], markers: readonly string[]): string {
  const first = candidates[0];
  if (first === undefined) throw new Error("找不到 Claude Desktop 的数据目录，请确认已安装并启动过 Claude Desktop。");
  for (const marker of markers) {
    const hit = candidates.find((candidate) => existsSync(join(candidate, marker)));
    if (hit !== undefined && hit.length > 0) return hit;
  }
  const existing = candidates.find((candidate) => existsSync(candidate));
  return existing ?? first;
}

/**
 * 当前平台的 Claude Desktop 3p 数据根（`Claude-3p` 目录本身）。
 * 写入新 profile 时用这个根下的 `configLibrary`。
 */
export function desktopDataRoot(home: string = resolveHome(), opts?: PlatformOptions): string {
  return pickRoot(desktopDataRootCandidates(home, opts), ["configLibrary", "local-agent-mode-sessions"]);
}

/**
 * 官方 usage-ledger 的会话根：`<3p根>/local-agent-mode-sessions`。
 * 优先选真正含 `local-agent-mode-sessions` 的候选（引擎数据可能落在与
 * `configLibrary` 不同的候选里）；都不含时按 `desktopDataRoot` 的结论拼。
 */
export function localAgentSessionsRoot(
  home: string = resolveHome(),
  opts?: PlatformOptions,
): string {
  const candidates = desktopDataRootCandidates(home, opts);
  const root = pickRoot(candidates, ["local-agent-mode-sessions", "configLibrary"]);
  return join(root, "local-agent-mode-sessions");
}

/**
 * 诊断用：列出探测到的全部候选及其可读状态，供 CLI `doctor` 与 UI 的
 * "路径设置"面板展示（用户可据此填写 `--claude-root`）。
 */
export interface DesktopRootCandidate {
  readonly path: string;
  readonly exists: boolean;
  readonly hasConfigLibrary: boolean;
  readonly hasLocalAgentSessions: boolean;
}

export function inspectDesktopRoots(
  home: string = resolveHome(),
  opts?: PlatformOptions,
): DesktopRootCandidate[] {
  return desktopDataRootCandidates(home, opts).map((path) => ({
    path,
    exists: existsSync(path),
    hasConfigLibrary: existsSync(join(path, "configLibrary")),
    hasLocalAgentSessions: existsSync(join(path, "local-agent-mode-sessions")),
  }));
}
