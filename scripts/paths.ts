/**
 * paths 命令（诊断用，不写任何文件）。
 *
 * 打印本机探测到的 Claude-3p 数据根候选与最终采用值，解决 Windows 上
 * "自动探测到底选中了哪个目录" 不透明的问题：
 * - 安装版与商店版（MSIX）数据根并存时，会列出全部候选及其状态；
 * - 探测失败或用户想改指向时，用 `--claude-root <目录>` 手工指定。
 *
 * 只读：不创建目录、不改档案。
 */

import { join } from "node:path";

const USAGE = `用法：
  claudeharbor paths    列出 Claude 数据根候选、采用值与 Harbor 数据目录
`;

interface PlatformApi {
  inspectDesktopRoots(home?: string): readonly {
    readonly path: string;
    readonly exists: boolean;
    readonly hasConfigLibrary: boolean;
    readonly hasLocalAgentSessions: boolean;
  }[];
  desktopDataRoot(home?: string): string;
  localAgentSessionsRoot(home?: string): string;
  harborRoot(home?: string): string;
  claudeCodeRoot(home?: string): string;
  resolveHome(): string;
}

/** paths 命令入口：由 claudeharbor.ts 分发调用，返回退出码。 */
export async function runPaths(args: readonly string[]): Promise<number> {
  if (args.length !== 0) {
    console.error("错误：paths 不接收额外参数");
    console.error(USAGE);
    return 2;
  }

  // home / claude-root 已由入口经 env 注入，此处直接用平台层默认值。
  const { platform } = (await import("../core/index.ts")) as { platform: PlatformApi };
  const home = platform.resolveHome();
  const rows = platform.inspectDesktopRoots(home);
  const chosen = platform.desktopDataRoot(home);
  const sessions = platform.localAgentSessionsRoot(home);

  console.log(`平台：${process.platform}`);
  console.log(`用户主目录：${home}`);
  console.log("Claude-3p 数据根候选：");
  for (const row of rows) {
    const flags: string[] = [];
    if (row.hasConfigLibrary) flags.push("configLibrary");
    if (row.hasLocalAgentSessions) flags.push("local-agent-mode-sessions");
    const state = row.exists ? (flags.length > 0 ? `存在（${flags.join("、")}）` : "存在（无关键目录）") : "不存在";
    const mark = row.path === chosen ? "→" : " ";
    console.log(`  ${mark} ${row.path}  [${state}]`);
  }
  console.log(`采用：${chosen}`);
  console.log(`configLibrary：${join(chosen, "configLibrary")}`);
  console.log(`官方账本根：${sessions}`);
  console.log(`Harbor 数据根：${platform.harborRoot(home)}`);
  console.log(`Claude Code 配置：${platform.claudeCodeRoot(home)}`);
  console.log("");
  console.log("如采用值不对：claudeharbor --claude-root <Claude-3p 目录> <命令>");
  return 0;
}
