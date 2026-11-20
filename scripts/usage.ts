/** usage 命令组：同步官方 usage-ledger 账本镜像，并对镜像做聚合查询。 */

import { aggregateUsage, syncLedger } from "../core/usage/index.ts";
import type { UsageFilter } from "../core/usage/index.ts";

/** 命令组公共选项：home 注入（由入口的全局 --home 传入）。 */
export interface UsageCommandOptions {
  readonly home?: string;
}

const USAGE = `用法：
  claudeharbor usage sync
  claudeharbor usage query [--day <YYYY-MM-DD>] [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>]
                           [--surface <界面>] [--origin <原因>] [--model <模型名>]
`;

function printUsageError(message: string): number {
  console.error(`错误：${message}`);
  console.error(USAGE);
  return 2;
}

/** usage 命令入口：由 claudeharbor.ts 分发调用，返回退出码。 */
export async function runUsage(
  args: readonly string[],
  opts: UsageCommandOptions = {},
): Promise<number> {
  const [sub, ...rest] = args;
  try {
    if (sub === "sync") {
      if (rest.length !== 0) return printUsageError("usage sync 不接收额外参数");
      const result = syncLedger({ home: opts.home });
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }

    if (sub === "query") {
      const parsed = parseQueryArgs(rest);
      if (typeof parsed === "number") return parsed;
      const result = aggregateUsage(parsed, { home: opts.home });
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }

    return printUsageError(`未知 usage 子命令 "${String(sub)}"`);
  } catch (err) {
    console.error(`错误：${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

const QUERY_FLAGS = ["--day", "--from", "--to", "--surface", "--origin", "--model"] as const;

function parseQueryArgs(args: readonly string[]): UsageFilter | number {
  const filter: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag !== undefined && (QUERY_FLAGS as readonly string[]).includes(flag)) {
      if (value === undefined || value.startsWith("--")) {
        return printUsageError(`${flag} 需要一个参数`);
      }
      filter[flag.slice(2)] = value;
      i += 1;
    } else {
      return printUsageError(`未知标志 "${String(flag)}"`);
    }
  }
  return filter as UsageFilter;
}
