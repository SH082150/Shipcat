/**
 * status 命令组（scripts/status.ts）。
 *
 * 汇总一块打印四段，只读不改任何状态：
 * 1. 当前激活：本地 _meta appliedId → 名；再读 Claude _meta 交叉验证，
 *    激活指针或显示名不一致标 ⚠；
 * 2. profiles 表：名 / UUID / mode / 条目数 / ★（= 当前激活）；
 * 3. 供应商表：名 / UUID；
 * 4. 网关探活：激活的 advanced 请求 http://127.0.0.1:<port>/health（2 秒
 *    超时，有 HTTP 响应即"运行中"，否则"未运行"）；standard / readOnly /
 *    无激活显示"无需网关"。
 *
 * core/index 经惰性加载并适配导出形状（扁平导出或 archive.<ns> 命名空间均可）。
 * --home 由入口经 env CLAUDEHARBOR_HOME 注入（core 路径表缺省 resolveHome()，Windows 上不读 HOME）。
 */

import type { HarborProfile, MetaEntry, ProfilesMeta } from "../core/types.ts";
import { printTable } from "./provider.ts";

/** 命令组公共选项：home 注入（由入口的全局 --home 传入，经 env CLAUDEHARBOR_HOME 生效）。 */
export interface StatusCommandOptions {
  readonly home?: string;
}

/** Claude _meta.json 的形状（core claudeMeta.read 的返回）。 */
interface ClaudeMetaShape {
  readonly appliedId: string | null;
  readonly entries: readonly MetaEntry[];
}

interface ProfilesApi {
  meta(): ProfilesMeta;
  get(idOrName: string): unknown;
}

interface ProvidersApi {
  list(): MetaEntry[] | Promise<MetaEntry[]>;
}

interface ClaudeMetaApi {
  read(): ClaudeMetaShape;
}

/** core/index 汇总出口里本命令组用到的公共 API 面。 */
interface CoreFacade {
  profiles: ProfilesApi;
  providers: ProvidersApi;
  claudeMeta: ClaudeMetaApi;
  check?: {
    scan?: (o?: { home?: string }) => { actions: readonly { message: string }[] };
  };
}

const USAGE = `用法：
  claudeharbor status   汇总：当前激活 / profiles 表 / 供应商表 / 网关探活
`;

function isModuleNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === "ERR_MODULE_NOT_FOUND";
}

function pick(record: unknown, key: string): unknown {
  if (typeof record === "object" && record !== null) {
    return (record as Record<string, unknown>)[key];
  }
  return undefined;
}

/** 惰性加载 core/index 并适配导出形状（扁平导出或 archive.<ns> 命名空间均可）。 */
async function loadCore(): Promise<CoreFacade> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import("../core/index.ts")) as unknown as Record<string, unknown>;
  } catch (err) {
    if (isModuleNotFound(err)) {
      throw new Error("内核未加载：core/index 不可用");
    }
    throw err;
  }

  const archiveNs = pick(mod, "archive");
  const profiles = (pick(mod, "profiles") ?? pick(archiveNs, "profiles")) as ProfilesApi | undefined;
  const providers = (pick(mod, "providers") ?? pick(archiveNs, "providers")) as ProvidersApi | undefined;
  const claudeMeta = (pick(mod, "claudeMeta") ?? pick(archiveNs, "claudeMeta")) as ClaudeMetaApi | undefined;
  const check = (pick(mod, "check") ?? pick(archiveNs, "check")) as CoreFacade["check"] | undefined;
  if (
    profiles === undefined ||
    typeof profiles.meta !== "function" ||
    typeof profiles.get !== "function" ||
    providers === undefined ||
    typeof providers.list !== "function" ||
    claudeMeta === undefined ||
    typeof claudeMeta.read !== "function"
  ) {
    throw new Error("status 模块集成中：core/index 的 profiles / providers / claudeMeta 命名空间尚未交付");
  }
  return {
    profiles,
    providers,
    claudeMeta,
    ...(check === undefined ? {} : { check }),
  };
}

/** 网关探活：2 秒内拿到任何 HTTP 响应即运行中（端口有服务在监听）。 */
async function probeHealth(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 2000);
  try {
    await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** status 命令组入口：由 claudeharbor.ts 分发调用，返回退出码。 */
export async function runStatus(
  args: readonly string[],
  opts: StatusCommandOptions = {},
): Promise<number> {
  const [sub] = args;
  if (sub === "--help" || sub === "-h" || sub === "help") {
    console.log(USAGE);
    return 0;
  }
  if (args.length !== 0) {
    console.error(`错误：status 不接收额外参数（收到 "${args.join(" ")}")`);
    return 2;
  }
  void opts; // home 已由入口经 env CLAUDEHARBOR_HOME 注入

  const core = await loadCore();
  // ⓪ 三情形探测：status 也先自动处置并打印（与 activate/gateway-run 同一道）。
  const scanFn = (core.check as { scan?: (o?: { home?: string }) => { actions: readonly { message: string }[] } } | undefined)?.scan;
  if (typeof scanFn === "function") {
    for (const action of scanFn(opts.home === undefined ? undefined : { home: opts.home }).actions) {
      console.log(`同步：${action.message}`);
    }
  }
  const local = core.profiles.meta();

  // ---- 当前激活：本地 appliedId → 名，读 Claude _meta 交叉验证 ----
  let activated: HarborProfile | null = null;
  const appliedEntry = local.appliedId === null
    ? null
    : local.entries.find((e) => e.id === local.appliedId) ?? null;
  if (local.appliedId === null) {
    console.log("当前激活：无");
  } else if (appliedEntry === null) {
    console.log(`当前激活：⚠ 本地激活指针「${local.appliedId}」在索引中不存在（profiles/_meta.json 已损坏，请检查）`);
  } else {
    let line = `当前激活：${appliedEntry.name}（${appliedEntry.id}）`;
    const claude = core.claudeMeta.read();
    if (claude.appliedId !== appliedEntry.id) {
      const claudeText = claude.appliedId === null ? "无激活记录" : `指向「${claude.appliedId}」`;
      line += ` ⚠ 与 Claude 侧激活不一致（Claude 侧${claudeText}，可能尚未启动 Desktop 或被外部改动）`;
    } else {
      const claudeName = claude.entries.find((e) => e.id === appliedEntry.id)?.name;
      if (claudeName !== undefined && claudeName !== appliedEntry.name) {
        line += ` ⚠ Claude 侧显示名「${claudeName}」与本地「${appliedEntry.name}」不一致`;
      }
    }
    console.log(line);
    try {
      activated = core.profiles.get(appliedEntry.id) as HarborProfile;
    } catch {
      activated = null; // 激活的 sidecar 损坏：profiles 表该行会以 - 占位。
    }
  }

  // ---- profiles 表 ----
  if (local.entries.length === 0) {
    console.log("Profiles：（profile 库为空，先用 claudeharbor profile create 创建）");
  } else {
    console.log("Profiles：");
    const rows = local.entries.map((e) => {
      try {
        const profile = core.profiles.get(e.id) as HarborProfile;
        return [
          e.name,
          e.id,
          profile.mode,
          String(profile.inferenceModels.length),
          local.appliedId === e.id ? "★" : "",
        ];
      } catch {
        // 索引在而 sidecar 损坏（ARCHIVE_CORRUPT）：该行其余列以 - 占位。
        return [e.name, e.id, "-", "-", local.appliedId === e.id ? "★" : ""];
      }
    });
    printTable(["名称", "UUID", "MODE", "条目数", "激活"], rows);
  }

  // ---- 供应商表 ----
  const providers = await core.providers.list();
  if (providers.length === 0) {
    console.log("供应商：（供应商库为空，先用 claudeharbor provider add 添加）");
  } else {
    console.log("供应商：");
    printTable(["名称", "UUID"], providers.map((e) => [e.name, e.id]));
  }

  // ---- 网关探活 ----
  if (activated !== null && activated.mode === "advanced") {
    const alive = await probeHealth(activated.port);
    console.log(
      alive
        ? `网关：运行中（http://127.0.0.1:${activated.port}/health）`
        : `网关：未运行（http://127.0.0.1:${activated.port}/health 无响应，用 claudeharbor gateway-run <名> 启动）`,
    );
  } else if (activated !== null && activated.mode === "standard") {
    console.log("网关：无需网关（标准配置直连供应商，不经过本地网关）");
  } else if (activated !== null) {
    console.log("网关：无需网关（只读镜像仅查看，不可激活）");
  } else {
    console.log("网关：无需网关（当前无激活 profile）");
  }

  return 0;
}
