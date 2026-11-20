/**
 * gateway-run 命令（scripts/gateway-run.ts）。
 *
 * 仅启动本地网关（调试入口；不写 Claude 目录）。激活与网关分离：网关
 * 启动前自建一致性门禁。流程为 profiles.get（readOnly/standard 拒绝：
 * 仅 advanced 需要网关）→ check.gate 门禁（不过打印差异退出 1）→ 收集
 * inferenceModels 并逐个解析供应商 → startGateway → 打印
 * 「网关监听 127.0.0.1:<port>（Ctrl-C 停止）」并挂住进程，SIGINT/SIGTERM
 * 时 close() 后退出 0。
 *
 * home 注入：入口已把 --home 经 env CLAUDEHARBOR_HOME 在 core 首次加载前
 * 注入；opts.home 仅测试直注用（profiles/providers 的 opts 参数原样透传）。
 */

import { pathToFileURL } from "node:url";

import type { AdvancedModelEntry, HarborProfile, Provider } from "../core/types.ts";
import { printTable } from "./provider.ts";

/** 命令选项：home 注入（由入口的全局 --home 传入，经 env CLAUDEHARBOR_HOME 生效）。 */
export interface GatewayRunCommandOptions {
  readonly home?: string;
}

/** startGateway 的选项面（与 core/gateway/0-server 契约对齐，结构类型）。 */
export interface StartGatewayOptions {
  readonly port: number;
  readonly token: string;
  readonly entries: readonly AdvancedModelEntry[];
  readonly resolveProvider: (providerId: string) => Provider | undefined;
  readonly customHeaders?: Record<string, string>;
}

/** startGateway 的返回面：实际绑定端口 + 关闭句柄。 */
export interface GatewayHandle {
  readonly port: number;
  close(): unknown;
}

const USAGE = `用法：
  claudeharbor gateway-run <id或名>     仅启动本地网关（调试；不写 Claude 目录）
`;

/** gateway-run 命令入口：由 claudeharbor.ts 分发调用，返回退出码。 */
export async function runGatewayRun(
  args: readonly string[],
  opts: GatewayRunCommandOptions = {},
): Promise<number> {
  if (args.length !== 1) {
    console.error("错误：gateway-run 需要 1 个参数：<id或名>");
    console.error(USAGE);
    return 2;
  }
  const pOpts = opts.home === undefined ? undefined : { home: opts.home };

  const core = (await import("../core/index.ts")) as Record<string, unknown>;
  const profiles = core.profiles as
    | { get(idOrName: string, o?: { home?: string }): unknown }
    | undefined;
  const providers = core.providers as
    | { getById(id: string, o?: { home?: string }): unknown }
    | undefined;
  if (profiles === undefined || typeof profiles.get !== "function") {
    console.error("错误：core/index 缺少 profiles 命名空间");
    return 1;
  }
  if (providers === undefined || typeof providers.getById !== "function") {
    console.error("错误：core/index 缺少 providers 命名空间");
    return 1;
  }

  // ① 读 sidecar；readOnly/standard 拒绝：只有 advanced 需要本地网关。
  let profile: HarborProfile;
  try {
    profile = profiles.get(args[0] as string, pOpts) as HarborProfile;
  } catch (err) {
    console.error(`错误：${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  if (profile.mode !== "advanced") {
    console.error(
      `错误：profile 是 ${profile.mode} 模式，仅 advanced 模式的 profile 需要启动网关（standard 直连供应商，readOnly 只是 Claude 外来配置的镜像）`,
    );
    return 1;
  }

  // ⓪ 三情形探测：自动处置孤儿/外来/文件缺失（与 activate 同一道）。
  const scanFn = (core.check as { scan?: (o?: { home?: string }) => { actions: readonly { message: string }[] } } | undefined)?.scan;
  if (typeof scanFn === "function") {
    for (const action of scanFn(pOpts).actions) {
      console.log(`⓪ ${action.message}`);
    }
  }

  // ② 一致性门禁：网关启动前两侧必须一致（与 activate 的门禁同一道）。
  const check = core.check as
    | { gate(profileId: string, o?: { home?: string }): { ok: boolean; diffs?: readonly { key?: string; local?: string; claude?: string }[] } }
    | undefined;
  if (check === undefined || typeof check.gate !== "function") {
    console.error("错误：core/index 缺少 check 命名空间");
    return 1;
  }
  let gate: { ok: boolean; diffs?: readonly { key?: string; local?: string; claude?: string }[] };
  try {
    gate = check.gate(args[0] as string, pOpts);
  } catch (err) {
    console.error(`错误：${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  if (!gate.ok) {
    console.error("错误：网关启动前两侧必须一致，差异如下（请先运行 activate，或按上表修正差异）");
    const rows = (gate.diffs ?? []).map((d) => [d.key ?? "?", d.local ?? "?", d.claude ?? "?"]);
    printTable(["字段", "本地值", "Claude 值"], rows);
    return 1;
  }
  console.log("② 一致性检查通过 ✓");

  // ③ 收集条目；④ 逐个解析供应商（文件缺失/损坏时交给网关跳过该路由）。
  const entries = profile.inferenceModels;
  const resolveProvider = (providerId: string): Provider | undefined => {
    try {
      return providers.getById(providerId, pOpts) as Provider;
    } catch {
      return undefined;
    }
  };

  // ⑤ 启动网关；core/index 的 gateway 命名空间未就绪时中文提示。
  const gateway = core.gateway as
    | { startGateway(o: StartGatewayOptions): Promise<GatewayHandle> }
    | undefined;
  if (gateway === undefined || typeof gateway.startGateway !== "function") {
    console.log("网关不可用：core/index 缺少 gateway.startGateway");
    return 0;
  }
  let handle: GatewayHandle;
  try {
    handle = await gateway.startGateway({
      port: profile.port,
      token: profile.gatewayToken,
      entries,
      resolveProvider,
      customHeaders: profile.claude?.inferenceCustomHeaders,
    });
  } catch (err) {
    console.error(`错误：网关启动失败：${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const bound = typeof handle?.port === "number" ? handle.port : profile.port;
  console.log(`网关监听 127.0.0.1:${bound}（Ctrl-C 停止）`);

  // ⑥ 挂住进程；SIGINT/SIGTERM 时 close() 后退出 0。
  const shutdown = (): void => {
    void Promise.resolve(handle.close?.()).catch(() => undefined).finally(() => {
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await new Promise<never>(() => undefined);
  return 0; // 不可达：仅SIGINT/SIGTERM 退出
}

// 直接作为脚本运行时（node scripts/gateway-run.ts ...）进入 runGatewayRun；
// 被测试/activate import 时只导出符号，不产生副作用。
const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  runGatewayRun(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(`错误：${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    },
  );
}
