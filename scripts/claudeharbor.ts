/**
 * CLI 入口（scripts/claudeharbor.ts）。
 *
 * 薄壳：解析全局选项（--home 注入）、按子命令分发到命令组
 * （provider/profile/gateway-run）、统一错误处理与输出风格——成功简短
 * 确认、list/show 表格化、失败打印中文消息 + 非零退出码。不含业务逻辑；
 * core 统一经 core/index 取用，具体调用由命令组模块负责。
 *
 * 退出码：0 = 成功；1 = 运行时失败（校验不过、core 结构化错误）；
 * 2 = 用法错误（参数个数/未知命令）。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** 全局选项：home 注入（测试/多环境时指向临时目录，缺省用 ~/.claudeharbor）。 */
export interface GlobalOptions {
  readonly home?: string;
  /** 手工指定的 Claude-3p 数据根（自动探测失败时使用）。 */
  readonly claudeRoot?: string;
}

const HELP = `用法：claudeharbor [--home <目录>] [--claude-root <目录>] <命令> [参数]

命令：
  provider add <名称> <baseUrl> <密钥> [authScheme]   添加供应商（authScheme 默认 x-api-key）
  provider list | remove <名称> | rename <旧名> <新名>
  profile create <名称> --mode standard|advanced [--port --token --auth-scheme]
  profile list | show <id或名> | import <UUID> | check <id或名> | remove <id或名>
  profile route-add <profile> --name <假名> --provider <供应商名> [--upstream <真模型>]
  profile route-remove <profile> <假名>
  profile route-update <profile> <假名> [--label --tier --upstream --provider]
  activate <id或名>        激活 profile（检查一致性并更新 appliedId；不启动网关）
  gateway-run <id或名>     启动 advanced profile 的本地网关（不写 Claude 目录）
  status                  查看激活状态、两侧一致性与网关运行状态
  paths                   打印本机探测到的 Claude 数据目录（Windows 多候选）
  usage sync              镜像官方 usage-ledger 账本到本地（增量 + 改写检测）
  usage query [--day --from --to --surface --origin --model]   聚合查询本地镜像账本

全局选项：
  --home <目录>        指定用户主目录（用于测试/隔离；仅接受在命令之前）
  --claude-root <目录> 手工指定 Claude-3p 数据根（自动探测失败时使用；仅接受在命令之前）
  --version            打印版本号
`;

/** 从 thrown 值里取出中文可读消息；core 的结构化错误都带 message。 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    typeof err === "object" && err !== null &&
    "message" in err && typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return String(err);
}

/**
 * 读 package.json 的 version（`--version` 用）。
 *
 * 运行期版本号只有一个来源：包自己的 package.json。读不到时返回
 * "unknown" 而不是抛错——版本号查询不该因为打包方式不同而让 CLI 崩掉。
 */
function readVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

/** 解析全局选项（只接受子命令之前），返回剩余参数与两个目录覆盖值。 */
function parseGlobalOptions(argv: readonly string[]): {
  rest: string[];
  home?: string;
  claudeRoot?: string;
} {
  const rest = [...argv];
  let home: string | undefined;
  let claudeRoot: string | undefined;
  for (;;) {
    const head = rest[0];
    if (head === "--home") {
      const value = rest[1];
      if (value === undefined) {
        throw new UsageError("--home 需要一个目录参数");
      }
      home = value;
      rest.splice(0, 2);
    } else if (head !== undefined && head.startsWith("--home=")) {
      home = head.slice("--home=".length);
      if (home.length === 0) throw new UsageError("--home= 后面需要一个目录参数");
      rest.shift();
    } else if (head === "--claude-root") {
      const value = rest[1];
      if (value === undefined) {
        throw new UsageError("--claude-root 需要一个目录参数");
      }
      claudeRoot = value;
      rest.splice(0, 2);
    } else if (head !== undefined && head.startsWith("--claude-root=")) {
      claudeRoot = head.slice("--claude-root=".length);
      if (claudeRoot.length === 0) {
        throw new UsageError("--claude-root= 后面需要一个目录参数");
      }
      rest.shift();
    } else {
      break;
    }
  }
  const parsed: { rest: string[]; home?: string; claudeRoot?: string } = { rest };
  if (home !== undefined) parsed.home = home;
  if (claudeRoot !== undefined) parsed.claudeRoot = claudeRoot;
  return parsed;
}

/** 用法错误：打印用法提示，退出码 2。 */
class UsageError extends Error {}

function printUsageError(message: string): number {
  console.error(`错误：${message}`);
  console.error('输入 "claudeharbor --help" 查看用法。');
  return 2;
}

/** 惰性加载命令组模块；模块缺失时给出中文提示而不是模块解析崩溃。 */
async function importGroup(specifier: string): Promise<Record<string, unknown>> {
  try {
    return (await import(specifier)) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code === "ERR_MODULE_NOT_FOUND") {
      const file = specifier.replace(/^\.\//, "scripts/");
      throw new Error(`命令组不可用：${file} 缺失`);
    }
    throw err;
  }
}

type GroupRunner = (args: readonly string[], opts: GlobalOptions) => Promise<number> | number;

async function dispatch(command: string, args: readonly string[], opts: GlobalOptions): Promise<number> {
  switch (command) {
    case "provider": {
      const mod = await importGroup("./provider.ts");
      return (mod.runProvider as GroupRunner)(args, opts);
    }
    case "profile": {
      const mod = await importGroup("./profile.ts");
      return (mod.runProfile as GroupRunner)(args, opts);
    }
    case "activate": {
      const mod = await importGroup("./activate.ts");
      return (mod.runActivate as GroupRunner)(args, opts);
    }
    case "gateway-run": {
      const mod = await importGroup("./gateway-run.ts");
      return (mod.runGatewayRun as GroupRunner)(args, opts);
    }
    case "status": {
      const mod = await importGroup("./status.ts");
      return (mod.runStatus as GroupRunner)(args, opts);
    }
    case "usage": {
      const mod = await importGroup("./usage.ts");
      return (mod.runUsage as GroupRunner)(args, opts);
    }
    case "paths": {
      const mod = await importGroup("./paths.ts");
      return (mod.runPaths as GroupRunner)(args, opts);
    }
    default:
      throw new UsageError(`未知命令 "${command}"`);
  }
}

/** CLI 主入口：返回进程退出码（0 成功；非 0 失败，消息已打印到 stderr）。 */
export async function main(argv: readonly string[]): Promise<number> {
  let opts: GlobalOptions;
  let rest: readonly string[];
  try {
    const parsed = parseGlobalOptions(argv);
    rest = parsed.rest;
    if (parsed.home !== undefined) {
      // core 的路径表缺省取 resolveHome()：`CLAUDEHARBOR_HOME` 优先于
      // 平台默认主目录。模块内惰性缓存，故只能经 env 注入，且必须在
      // core 首次加载前（本函数即入口，满足该约束）。
      // 不用 HOME：Windows 上 os.homedir() 读 USERPROFILE，Git Bash 的
      // HOME 还是 POSIX 写法，直接写 HOME 在 Windows 上不生效。
      process.env.CLAUDEHARBOR_HOME = parsed.home;
    }
    if (parsed.claudeRoot !== undefined) {
      // 手工指定 Claude-3p 数据根（跳过自动探测），供探测失败时使用。
      process.env.CLAUDEHARBOR_CLAUDE_ROOT = parsed.claudeRoot;
    }
    opts = {};
    if (parsed.home !== undefined) (opts as { home?: string }).home = parsed.home;
    if (parsed.claudeRoot !== undefined) {
      (opts as { claudeRoot?: string }).claudeRoot = parsed.claudeRoot;
    }
  } catch (err) {
    if (err instanceof UsageError) return printUsageError(err.message);
    throw err;
  }

  const [command, ...args] = rest;
  if (command === "--version" || command === "-v" || command === "version") {
    console.log(readVersion());
    return 0;
  }
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    console.log(HELP);
    return 0;
  }

  try {
    return await dispatch(command, args, opts);
  } catch (err) {
    if (err instanceof UsageError) return printUsageError(err.message);
    console.error(`错误：${errorMessage(err)}`);
    return 1;
  }
}

// 直接作为脚本运行时（node scripts/claudeharbor.ts ...）进入 main；
// 被测试 import 时只导出符号，不产生副作用。
const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(`错误：${errorMessage(err)}`);
      process.exitCode = 1;
    },
  );
}
