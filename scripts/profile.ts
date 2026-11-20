/**
 * profile 命令组（scripts/profile.ts）。
 *
 * 子命令：create（交互补齐必填项）/ list / show / import / check / remove /
 * route-add / route-remove / route-update（模型路由条目增删改）。
 * 只解析参数、调 core 公共 API（统一经 core/index 取货）、打印结果；
 * 不含业务逻辑。apiKey / gatewayToken 展示一律打码。
 *
 * core/index 经惰性加载并适配导出形状（扁平导出或 archive.<ns> 命名空间均可）。
 * --home 由入口经 env CLAUDEHARBOR_HOME 注入（core 路径表缺省 resolveHome()，Windows 上不读 HOME）。
 */

import { createInterface } from "node:readline";

import type { HarborProfile, MetaEntry, ProfilesMeta } from "../core/types.ts";
import { maskApiKey, printTable } from "./provider.ts";

/** 命令组公共选项：home 注入（由入口的全局 --home 传入，经 env CLAUDEHARBOR_HOME 生效）。 */
export interface ProfileCommandOptions {
  readonly home?: string;
}

/** import 诊断报告（与 core/archive/profiles 的 ImportReport 同形）。 */
interface ImportReport {
  readonly id: string;
  readonly name: string;
  readonly entryCount: number;
  readonly passthroughKeyCount: number;
}

interface ProfilesApi {
  create(input: Record<string, unknown>): unknown;
  list(): unknown;
  detailList?(): unknown;
  get(idOrName: string): unknown;
  remove(idOrName: string): unknown;
  rename(idOrName: string, newName: string): unknown;
  meta(): ProfilesMeta;
  importFromClaude(id: string): ImportReport;
  addEntry(idOrName: string, entry: Record<string, unknown>): unknown;
  updateEntry(idOrName: string, entry: Record<string, unknown>): unknown;
  removeEntry(idOrName: string, entry: Record<string, unknown>): unknown;
}

/** check.gate 的差异项（字段名以 core 实际形状为准，打印时做适配）。 */
interface GateDiff {
  readonly field?: string;
  readonly key?: string;
  readonly local?: unknown;
  readonly expected?: unknown;
  readonly claude?: unknown;
  readonly actual?: unknown;
}

interface GateResult {
  readonly ok: boolean;
  readonly diffs?: readonly GateDiff[];
}

interface CheckApi {
  gate(profileId: string): GateResult | Promise<GateResult>;
}

/** core/index 汇总出口里本命令组用到的公共 API 面。 */
interface CoreFacade {
  profiles: ProfilesApi;
  providers: ProvidersApi;
  check?: CheckApi;
}

/** providers 命名空间：route 子命令按名字解析供应商 UUID 用。 */
interface ProvidersApi {
  list(): MetaEntry[] | Promise<MetaEntry[]>;
}

function isModuleNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === "ERR_MODULE_NOT_FOUND";
}

function pick(record: unknown, key: string): unknown {
  if (typeof record === "object" && record !== null) {
    return (record as Record<string, unknown>)[key];
  }
  return undefined;
}

/**
 * 惰性加载 core/index 并适配导出形状。check 命名空间缺失时由 cmdCheck
 * 单独报错，不影响其余子命令。
 */
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
  if (
    profiles === undefined ||
    typeof profiles.create !== "function" ||
    typeof profiles.get !== "function" ||
    typeof profiles.remove !== "function" ||
    typeof profiles.meta !== "function"
  ) {
    throw new Error("profile 模块集成中：core/index 的 profiles 命名空间尚未交付");
  }
  if (typeof profiles.importFromClaude !== "function") {
    throw new Error("profile 模块集成中：profiles.importFromClaude 尚未交付（待 import 集成后可用）");
  }
  if (
    typeof profiles.addEntry !== "function" ||
    typeof profiles.updateEntry !== "function" ||
    typeof profiles.removeEntry !== "function"
  ) {
    throw new Error("profile 模块集成中：profiles 的条目 API（addEntry/updateEntry/removeEntry）尚未交付");
  }

  const providers = (pick(mod, "providers") ?? pick(archiveNs, "providers")) as ProvidersApi | undefined;
  if (providers === undefined || typeof providers.list !== "function") {
    throw new Error("profile 模块集成中：core/index 的 providers 命名空间尚未交付");
  }

  const checkNs = (pick(mod, "check") ?? pick(archiveNs, "check")) as CheckApi | undefined;
  const facade: CoreFacade = { profiles, providers, check: checkNs };
  return facade;
}

/** 按 UUID 或名字解析 profile id（_meta entries 查 id 再查 name）。 */
function resolveId(meta: ProfilesMeta, idOrName: string): MetaEntry {
  const entry = meta.entries.find((e) => e.id === idOrName)
    ?? meta.entries.find((e) => e.name === idOrName);
  if (!entry) throw new Error(`profile「${idOrName}」不存在`);
  return entry;
}

/** 按名字解析供应商 UUID（providers.list 找 id）；查不到返回 null。 */
async function resolveProviderId(core: CoreFacade, name: string): Promise<string | null> {
  const entries = await core.providers.list();
  return entries.find((e) => e.name === name)?.id ?? null;
}

// ---------- 交互补齐（从 stdin 逐行读；EOF 视为空串） ----------

/** 生成一个逐行提问器：stdin EOF 或已关闭时一律回空串，绝不挂起。 */
function makePrompter(): (label: string) => Promise<string> {
  const rl = createInterface({ input: process.stdin, terminal: false });
  let closed = false;
  rl.on("close", () => {
    closed = true;
  });
  return (label: string) => {
    if (closed) return Promise.resolve("");
    return new Promise<string>((resolve) => {
      const onClose = (): void => {
        rl.off("close", onClose);
        resolve("");
      };
      rl.once("close", onClose);
      rl.question(label, (answer) => {
        rl.off("close", onClose);
        resolve(answer.trim());
      });
    });
  };
}

const USAGE = `用法：
  claudeharbor profile create <名称> --mode standard|advanced [--port --token --auth-scheme]
  claudeharbor profile list                              列出 profile（★ = 当前激活）
  claudeharbor profile show <id或名>                     sidecar 全文（敏感字段打码）
  claudeharbor profile import <UUID>                     导入 Claude 外来 profile（readOnly 镜像）
  claudeharbor profile check <id或名>                    比对本地期望与 Claude 实际（差异三列）
  claudeharbor profile remove <id或名>                   删除 profile
  claudeharbor profile route-add <profile> --name <假名> --provider <供应商名>
                                                         [--upstream <真模型> --label --tier --behaves-as]
  claudeharbor profile route-remove <profile> <假名>     删除路由条目
  claudeharbor profile route-update <profile> <假名> [--label --tier --upstream --provider]
                                                         修改路由条目
`;

function usageError(message: string): number {
  console.error(`错误：${message}`);
  console.error(USAGE);
  return 2;
}

interface CreateFlags {
  readonly name: string;
  readonly mode: "standard" | "advanced";
  readonly port?: string;
  readonly token?: string;
  readonly authScheme?: string;
}

/** 解析 create 参数：名称 + --mode 必填，--port/--token/--auth-scheme 可选；未知标志报错。 */
function parseCreateArgs(args: readonly string[]): CreateFlags | number {
  const name = args[0];
  if (name === undefined) {
    return usageError("profile create 需要 1 个参数：<名称>，并指定 --mode standard|advanced");
  }
  let mode: "standard" | "advanced" | undefined;
  let port: string | undefined;
  let token: string | undefined;
  let authScheme: string | undefined;
  for (let i = 1; i < args.length; i += 1) {
    const flag = args[i];
    const value = args[i + 1];
    switch (flag) {
      case "--mode":
        if (value === undefined) return usageError("--mode 需要 standard 或 advanced");
        if (value !== "standard" && value !== "advanced") {
          return usageError(`--mode 只支持 standard 或 advanced，收到 "${value}"`);
        }
        mode = value;
        i += 1;
        break;
      case "--port":
        if (value === undefined) return usageError("--port 需要一个端口号");
        port = value;
        i += 1;
        break;
      case "--token":
        if (value === undefined) return usageError("--token 需要一个值");
        token = value;
        i += 1;
        break;
      case "--auth-scheme":
        if (value === undefined) return usageError("--auth-scheme 需要 x-api-key 或 bearer");
        authScheme = value;
        i += 1;
        break;
      default:
        return usageError(`未知标志 "${String(flag)}"`);
    }
  }
  if (mode === undefined) {
    return usageError("profile create 必须指定 --mode standard|advanced");
  }
  return { name, mode, port, token, authScheme };
}

async function cmdCreate(args: readonly string[], opts: ProfileCommandOptions): Promise<number> {
  const parsed = parseCreateArgs(args);
  if (typeof parsed === "number") return parsed;
  void opts; // home 已由入口经 env CLAUDEHARBOR_HOME 注入

  const ask = makePrompter();
  let port: number | undefined;
  let token: string | undefined;
  let scheme: string | undefined;

  if (parsed.mode === "advanced") {
    const portText = parsed.port ?? (await ask("网关监听端口 port："));
    if (portText.trim().length === 0) {
      console.error("错误：缺少必填项 port（高级配置必须指定网关监听端口，可用 --port）");
      return 1;
    }
    const portNum = Number(portText);
    if (!Number.isInteger(portNum)) {
      console.error(`错误：port 必须是整数，收到 "${portText}"`);
      return 1;
    }
    port = portNum;

    token = parsed.token ?? (await ask("网关 token（回车采纳默认 claudeharbor-local）："));
    if (token.trim().length === 0) token = "claudeharbor-local";

    scheme = parsed.authScheme ?? (await ask("Desktop→网关鉴权方案 x-api-key|bearer（回车采纳默认 bearer）："));
    if (scheme.trim().length === 0) scheme = "bearer";
    if (scheme !== "x-api-key" && scheme !== "bearer") {
      console.error(`错误：--auth-scheme 只支持 x-api-key 或 bearer，收到 "${scheme}"`);
      return 1;
    }
  } else if (parsed.port !== undefined || parsed.token !== undefined || parsed.authScheme !== undefined) {
    console.error("错误：标准配置（standard）不经过本地网关，不能传 --port/--token/--auth-scheme（这些是高级配置字段）");
    return 1;
  }

  const core = await loadCore();
  const input: Record<string, unknown> = { name: parsed.name, mode: parsed.mode };
  if (port !== undefined) input.port = port;
  if (token !== undefined) input.gatewayToken = token;
  if (scheme !== undefined) input.gatewayAuthScheme = scheme;
  const entry = (await core.profiles.create(input)) as MetaEntry;
  console.log(`已创建 profile「${entry.name}」（${entry.id}）`);
  return 0;
}

async function cmdList(args: readonly string[], opts: ProfileCommandOptions): Promise<number> {
  if (args.length !== 0) {
    return usageError("profile list 不接收额外参数");
  }
  void opts;
  const core = await loadCore();
  const meta = core.profiles.meta();
  if (meta.entries.length === 0) {
    console.log("（profile 库为空，先用 claudeharbor profile create 创建）");
    return 0;
  }
  const rows = meta.entries.map((e) => {
    const profile = core.profiles.get(e.id) as HarborProfile;
    return [
      e.name,
      e.id,
      profile.mode,
      String(profile.inferenceModels.length),
      meta.appliedId === e.id ? "★" : "",
    ];
  });
  printTable(["名称", "UUID", "MODE", "条目数", "激活"], rows);
  return 0;
}

async function cmdShow(args: readonly string[], opts: ProfileCommandOptions): Promise<number> {
  if (args.length !== 1) {
    return usageError("profile show 需要 1 个参数：<id或名>");
  }
  void opts;
  const core = await loadCore();
  const profile = structuredClone(core.profiles.get(args[0] as string)) as Record<string, unknown>;
  if (profile.mode === "advanced" && typeof profile.gatewayToken === "string") {
    profile.gatewayToken = maskApiKey(profile.gatewayToken);
  }
  if (typeof profile.claude === "object" && profile.claude !== null && !Array.isArray(profile.claude)) {
    const claude = profile.claude as Record<string, unknown>;
    const headers = claude.inferenceCustomHeaders;
    if (typeof headers === "object" && headers !== null && !Array.isArray(headers)) {
      claude.inferenceCustomHeaders = Object.fromEntries(
        Object.keys(headers).map((name) => [name, "****"]),
      );
    }
  }
  console.log("sidecar 全文（敏感字段已打码）：");
  console.log(JSON.stringify(profile, null, 2));
  return 0;
}

async function cmdImport(args: readonly string[], opts: ProfileCommandOptions): Promise<number> {
  if (args.length !== 1) {
    return usageError("profile import 需要 1 个参数：<UUID>");
  }
  void opts;
  const core = await loadCore();
  const report = core.profiles.importFromClaude(args[0] as string);
  console.log(`已导入只读镜像「${report.name}」（${report.id}）`);
  console.log(`模型条目数：${report.entryCount}；透传键数：${report.passthroughKeyCount}`);
  console.log("只读，接管需删除重建");
  return 0;
}

/** 差异值的可打印形式：对象序列化、缺失标"（缺失）"。 */
function diffText(value: unknown): string {
  if (value === undefined || value === null) return "（缺失）";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function cmdCheck(args: readonly string[], opts: ProfileCommandOptions): Promise<number> {
  if (args.length !== 1) {
    return usageError("profile check 需要 1 个参数：<id或名>");
  }
  void opts;
  const core = await loadCore();
  if (core.check === undefined || typeof core.check.gate !== "function") {
    console.error("错误：core/index 未导出 check 命名空间");
    return 1;
  }
  const entry = resolveId(core.profiles.meta(), args[0] as string);
  const result = await core.check.gate(entry.id);
  if (result.ok) {
    console.log("一致 ✓");
    return 0;
  }
  console.error(`检查未通过：profile「${entry.name}」与 Claude 侧存在差异（处理选项：改本地后重新 check，或 activate 直接覆盖）`);
  const rows = (result.diffs ?? []).map((d) => [
    d.field ?? d.key ?? "?",
    diffText(d.local !== undefined ? d.local : d.expected),
    diffText(d.claude !== undefined ? d.claude : d.actual),
  ]);
  printTable(["字段", "本地值", "Claude 值"], rows);
  return 1;
}

async function cmdRemove(args: readonly string[], opts: ProfileCommandOptions): Promise<number> {
  if (args.length !== 1) {
    return usageError("profile remove 需要 1 个参数：<id或名>");
  }
  void opts;
  const core = await loadCore();
  await core.profiles.remove(args[0] as string);
  console.log(`已删除 profile「${args[0] as string}」`);
  return 0;
}

// ---------- route 子命令（模型路由条目增删改；校验在 core，这里只解析与转发） ----------

/** route 子命令共用的条目字段标志。 */
interface RouteFlags {
  name?: string;
  provider?: string;
  upstream?: string;
  label?: string;
  tier?: string;
  behavesAs?: string;
}

/** 解析 --name/--provider/--upstream/--label/--tier/--behaves-as（均须带值）；未知标志报用法错误。 */
function parseRouteFlags(args: readonly string[]): RouteFlags | number {
  const flags: RouteFlags = {};
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) {
      return usageError(`「${String(flag)}」需要一个值`);
    }
    switch (flag) {
      case "--name": flags.name = value; break;
      case "--provider": flags.provider = value; break;
      case "--upstream": flags.upstream = value; break;
      case "--label": flags.label = value; break;
      case "--tier": flags.tier = value; break;
      case "--behaves-as": flags.behavesAs = value; break;
      default: return usageError(`未知标志 "${String(flag)}"`);
    }
    i += 1;
  }
  return flags;
}

/** --tier 枚举校验（与 core ModelTier 一致）。 */
const MODEL_TIERS = ["haiku", "sonnet", "opus", "fable", "mythos"] as const;

function invalidTier(tier: string | undefined): number | null {
  if (tier !== undefined && !(MODEL_TIERS as readonly string[]).includes(tier)) {
    console.error(`错误：--tier 只支持 ${MODEL_TIERS.join(" / ")}，收到 "${tier}"`);
    return 1;
  }
  return null;
}

/**
 * 标准配置（standard）模型名原样直发供应商，没有上游改写的概念；
 * core 的条目校验只管 advanced 必须有 upstream，故 standard 带 --upstream
 * 在此按 create 拒绝 standard 传 --port 的同一先例拦截。
 */
function rejectUpstreamForStandard(mode: string, upstream: string | undefined): number | null {
  if (mode === "standard" && upstream !== undefined) {
    console.error("错误：标准配置（standard）模型名原样直发供应商，不能传 --upstream（--upstream 是高级配置的路由改写字段）");
    return 1;
  }
  return null;
}

async function cmdRouteAdd(args: readonly string[], opts: ProfileCommandOptions): Promise<number> {
  const profile = args[0];
  if (profile === undefined) {
    return usageError("profile route-add 需要 1 个参数：<profile>，并指定 --name <假名> --provider <供应商名>");
  }
  const flags = parseRouteFlags(args.slice(1));
  if (typeof flags === "number") return flags;
  if (flags.name === undefined) {
    return usageError("profile route-add 必须指定 --name <假名>（Claude 侧显示的模型 ID）");
  }
  if (flags.provider === undefined) {
    return usageError("profile route-add 必须指定 --provider <供应商名>");
  }
  const tierErr = invalidTier(flags.tier);
  if (tierErr !== null) return tierErr;
  void opts; // home 已由入口经 env CLAUDEHARBOR_HOME 注入

  const core = await loadCore();
  const target = core.profiles.get(profile) as HarborProfile;
  const modeErr = rejectUpstreamForStandard(target.mode, flags.upstream);
  if (modeErr !== null) return modeErr;
  const providerId = await resolveProviderId(core, flags.provider);
  if (providerId === null) {
    console.error(`错误：供应商「${flags.provider}」不存在，请先用 claudeharbor provider add 添加`);
    return 1;
  }

  const input: Record<string, unknown> = { name: flags.name, provider: providerId };
  if (flags.upstream !== undefined) input.upstreamModel = flags.upstream;
  if (flags.label !== undefined) input.labelOverride = flags.label;
  if (flags.tier !== undefined) input.anthropicFamilyTier = flags.tier;
  if (flags.behavesAs !== undefined) input.behavesAs = flags.behavesAs;
  await core.profiles.addEntry(profile, input);
  const upstreamText = flags.upstream === undefined ? "" : `，上游「${flags.upstream}」`;
  console.log(`已在 profile「${profile}」添加路由条目「${flags.name}」→ 供应商「${flags.provider}」${upstreamText}`);
  return 0;
}

async function cmdRouteRemove(args: readonly string[], opts: ProfileCommandOptions): Promise<number> {
  if (args.length !== 2) {
    return usageError("profile route-remove 需要 2 个参数：<profile> <假名>");
  }
  void opts;
  const core = await loadCore();
  await core.profiles.removeEntry(args[0] as string, { name: args[1] as string });
  console.log(`已从 profile「${args[0] as string}」删除路由条目「${args[1] as string}」`);
  return 0;
}

async function cmdRouteUpdate(args: readonly string[], opts: ProfileCommandOptions): Promise<number> {
  const [profile, alias, ...flagArgs] = args;
  if (profile === undefined || alias === undefined) {
    return usageError("profile route-update 需要 2 个参数：<profile> <假名>");
  }
  const flags = parseRouteFlags(flagArgs);
  if (typeof flags === "number") return flags;
  if (Object.keys(flags).length === 0) {
    return usageError("profile route-update 至少需要一个标志：--label / --tier / --upstream / --provider");
  }
  const tierErr = invalidTier(flags.tier);
  if (tierErr !== null) return tierErr;
  void opts;

  const core = await loadCore();
  const target = core.profiles.get(profile) as HarborProfile;
  const modeErr = rejectUpstreamForStandard(target.mode, flags.upstream);
  if (modeErr !== null) return modeErr;
  const models = target.inferenceModels as unknown as Record<string, unknown>[];
  const existing = models.find((m) => m.name === alias);
  if (existing === undefined) {
    console.error(`错误：profile「${profile}」里没有模型条目「${alias}」`);
    return 1;
  }
  const providerId = flags.provider === undefined
    ? existing.provider
    : await resolveProviderId(core, flags.provider);
  if (typeof providerId !== "string" || providerId.length === 0) {
    console.error(`错误：供应商「${String(flags.provider)}」不存在，请先用 claudeharbor provider add 添加`);
    return 1;
  }

  // updateEntry 按名字整条替换：未给标志的字段沿用旧值。
  const input: Record<string, unknown> = { ...existing, name: alias, provider: providerId };
  if (flags.upstream !== undefined) input.upstreamModel = flags.upstream;
  if (flags.label !== undefined) input.labelOverride = flags.label;
  if (flags.tier !== undefined) input.anthropicFamilyTier = flags.tier;
  await core.profiles.updateEntry(profile, input);
  console.log(`已更新 profile「${profile}」的路由条目「${alias}」`);
  return 0;
}

/** profile 命令组入口：由 claudeharbor.ts 分发调用，返回退出码。 */
export async function runProfile(
  args: readonly string[],
  opts: ProfileCommandOptions = {},
): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
    case "--help":
    case "-h":
    case "help":
      console.log(USAGE);
      return 0;
    case "create":
      return cmdCreate(rest, opts);
    case "list":
      return cmdList(rest, opts);
    case "show":
      return cmdShow(rest, opts);
    case "import":
      return cmdImport(rest, opts);
    case "check":
      return cmdCheck(rest, opts);
    case "remove":
      return cmdRemove(rest, opts);
    case "route-add":
      return cmdRouteAdd(rest, opts);
    case "route-remove":
      return cmdRouteRemove(rest, opts);
    case "route-update":
      return cmdRouteUpdate(rest, opts);
    default:
      return usageError(`未知子命令 "profile ${sub}"`);
  }
}
