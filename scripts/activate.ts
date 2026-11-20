/**
 * activate 命令（scripts/activate.ts）。
 *
 * 激活与网关分离：activate 只做"对齐名字 → 门禁 → 指向 → 镜像"的纯
 * 调度，不生成/改写 Claude profile 文件（创建即同步已保证两侧一致，
 * 覆写会丢用户在 Claude UI 的透传改动），也不启动网关——advanced 的
 * 网关由 scripts/gateway-run.ts 在启动前自建门禁。
 *
 * 流程（每步进度一行）：
 *   ① profiles.get 读 sidecar（readOnly 拒绝：不可更改，只能删除后重建）
 *   ② claudeMeta.syncNames 对齐 Claude 侧改名 → 回写本地 _meta 条目名
 *   ③ check.gate 一致性门禁——不一致打印差异三列并退出 1
 *   ④ claudeMeta.apply（appliedId 指向本 profile）
 *   ⑤ profiles 侧写 appliedId 镜像（直接原子写 profiles/_meta，保留 entries）
 *   ⑥ 打印结果：advanced 提示 gateway-run；standard 提示直连完成
 */

import { pathToFileURL } from "node:url";

import type { HarborProfile, MetaEntry, ProfilesMeta } from "../core/types.ts";
import { printTable } from "./provider.ts";

/** 命令选项：home 注入（由入口的全局 --home 传入，经 env CLAUDEHARBOR_HOME 生效）。 */
export interface ActivateCommandOptions {
  readonly home?: string;
}

interface ProfilesApi {
  get(idOrName: string): unknown;
  meta(): ProfilesMeta;
  rename(idOrName: string, newName: string): MetaEntry;
}

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
  scan?(o?: { home?: string }): { actions: readonly { message: string }[] };
}

interface ClaudeMetaApi {
  syncNames(ours: readonly MetaEntry[]): MetaEntry[];
  apply(id: string): unknown;
}

interface FsApi {
  atomicWriteJson(path: string, obj: unknown, mode: number): void;
  readonly NORMAL_MODE?: number;
}

interface PathsApi {
  harborPaths(home?: string): { readonly profilesMeta: string };
}

/** core/index 汇总出口里本命令用到的公共 API 面。 */
interface CoreFacade {
  profiles: ProfilesApi;
  check: CheckApi;
  claudeMeta: ClaudeMetaApi;
  fs: FsApi;
  paths: PathsApi;
}

const REQUIRED_NAMESPACES = ["check", "claudeMeta", "fs", "paths"] as const;

function isModuleNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === "ERR_MODULE_NOT_FOUND";
}

function pick(record: unknown, key: string): unknown {
  if (typeof record === "object" && record !== null) {
    return (record as Record<string, unknown>)[key];
  }
  return undefined;
}

function diffText(value: unknown): string {
  if (value === undefined || value === null) return "（缺失）";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * 惰性加载 core/index 的 profiles 命名空间（第①步只依赖它）。
 */
async function loadProfiles(): Promise<ProfilesApi> {
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
    typeof profiles.get !== "function" ||
    typeof profiles.meta !== "function"
  ) {
    throw new Error("内核接口缺失：core/index 未导出 profiles 命名空间");
  }
  return profiles;
}

/**
 * 惰性加载 core/index 其余命名空间并适配导出形状（扁平导出或
 * archive.<ns> 命名空间均可）。第②–⑤步用到 check/claudeMeta/fs/paths，
 * 缺一不可。
 */
async function loadChain(): Promise<CoreFacade> {
  const mod = (await import("../core/index.ts")) as unknown as Record<string, unknown>;
  const archiveNs = pick(mod, "archive");
  const facade: CoreFacade = {
    profiles: (pick(mod, "profiles") ?? pick(archiveNs, "profiles")) as CoreFacade["profiles"],
    check: (pick(mod, "check") ?? pick(archiveNs, "check")) as CoreFacade["check"],
    claudeMeta: (pick(mod, "claudeMeta") ?? pick(archiveNs, "claudeMeta")) as CoreFacade["claudeMeta"],
    fs: (pick(mod, "fs") ?? pick(archiveNs, "fs")) as CoreFacade["fs"],
    paths: (pick(mod, "paths") ?? pick(archiveNs, "paths")) as CoreFacade["paths"],
  };
  const missing = REQUIRED_NAMESPACES.filter(
    (ns) => facade[ns] === undefined || typeof facade[ns] !== "object",
  );
  if (missing.length > 0) {
    throw new Error(`内核接口缺失：core/index 缺少 ${missing.join(" / ")} 命名空间`);
  }
  if (
    typeof facade.profiles.rename !== "function" ||
    typeof facade.check.gate !== "function" ||
    typeof facade.claudeMeta.syncNames !== "function" ||
    typeof facade.claudeMeta.apply !== "function" ||
    typeof facade.fs.atomicWriteJson !== "function" ||
    typeof facade.paths.harborPaths !== "function"
  ) {
    throw new Error("内核接口缺失：core/index 的导出形状不符合预期");
  }
  return facade;
}

/** 按 UUID 或名字解析 profile 条目（_meta entries 查 id 再查 name）。 */
function resolveEntry(meta: ProfilesMeta, idOrName: string): MetaEntry {
  const entry = meta.entries.find((e) => e.id === idOrName)
    ?? meta.entries.find((e) => e.name === idOrName);
  if (!entry) throw new Error(`profile「${idOrName}」不存在`);
  return entry;
}

const USAGE = `用法：
  claudeharbor activate <id或名>     激活 profile（对齐名字 → 一致性门禁 → 指向 → 镜像）
`;

/** activate 命令入口：由 claudeharbor.ts 分发调用，返回退出码。 */
export async function runActivate(
  args: readonly string[],
  opts: ActivateCommandOptions = {},
): Promise<number> {
  if (args.length !== 1) {
    console.error("错误：activate 需要 1 个参数：<id或名>");
    console.error(USAGE);
    return 2;
  }
  void opts; // home 已由入口经 env CLAUDEHARBOR_HOME 注入

  // ① 读 sidecar；readOnly 拒绝（不可更改，只能删除后重建）。
  const profiles = await loadProfiles();
  let entry = resolveEntry(profiles.meta(), args[0] as string);
  const profile = profiles.get(entry.id) as HarborProfile;
  if (profile.mode === "readOnly") {
    console.error(
      `错误：profile「${entry.name}」是 Claude 外来配置的只读镜像（readOnly），不可激活；想接管请删除后重新创建 standard/advanced profile`,
    );
    return 1;
  }
  console.log(`① 已读取 profile「${entry.name}」（${entry.id}，${profile.mode}）`);

  const core = await loadChain();

  // ⓪ 三情形探测：自动处置孤儿删除/外来建只读/文件缺失重建。
  if (typeof core.check.scan === "function") {
    const result = core.check.scan(opts.home === undefined ? undefined : { home: opts.home });
    for (const action of result.actions) {
      console.log(`⓪ ${action.message}`);
    }
  }

  // ② Claude 侧改名的对齐回写（以 Claude 侧为准，只动本地 _meta）。
  const renames = core.claudeMeta.syncNames(core.profiles.meta().entries);
  for (const r of renames) {
    const oldName = entry.id === r.id ? entry.name : (core.profiles.meta().entries.find((e) => e.id === r.id)?.name ?? r.id);
    core.profiles.rename(r.id, r.name);
    console.log(`② Claude 侧已将「${oldName}」改名为「${r.name}」，已回写本地`);
  }

  // ③ 一致性门禁；不一致打印差异三列并退出 1。
  const gate = await core.check.gate(entry.id);
  if (!gate.ok) {
    console.error("③ 一致性检查未通过，差异如下（处理方式：按上表修正差异后重新 check，或删除 Claude 侧重名条目让系统重建镜像）");
    const rows = (gate.diffs ?? []).map((d) => [
      d.field ?? d.key ?? "?",
      diffText(d.local !== undefined ? d.local : d.expected),
      diffText(d.claude !== undefined ? d.claude : d.actual),
    ]);
    printTable(["字段", "本地值", "Claude 值"], rows);
    return 1;
  }
  console.log("③ 一致性检查通过 ✓");

  // ④ Claude _meta：appliedId 指向本 profile（创建即同步已保证条目在册）。
  await core.claudeMeta.apply(entry.id);
  console.log("④ 已更新 Claude _meta（appliedId 指向本 profile）");

  // ⑤ profiles 侧 appliedId 镜像：直接原子写 _meta，保留 entries。
  //    改名回写后重新解析条目，保证镜像与最新名字一致。
  entry = resolveEntry(core.profiles.meta(), entry.id);
  const meta = core.profiles.meta();
  core.fs.atomicWriteJson(
    core.paths.harborPaths().profilesMeta,
    { version: 1, appliedId: entry.id, entries: meta.entries },
    core.fs.NORMAL_MODE ?? 0o644,
  );
  console.log("⑤ 已同步本地 appliedId 镜像");

  // ⑥ 激活与网关分离：advanced 需另行启动网关（gateway-run 自带门禁）。
  if (profile.mode === "advanced") {
    console.log(`✓ 已激活 ${entry.name}。启动网关：claudeharbor gateway-run ${entry.name}（advanced）`);
  } else {
    console.log(`✓ 已激活 ${entry.name}。（standard 直连供应商，无需启动网关；Desktop 重启后生效）`);
  }
  return 0;
}

// 被测试 import 时只导出符号；直接作为脚本运行（node scripts/activate.ts）
// 时提供与入口一致的行为。
const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  runActivate(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(`错误：${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    },
  );
}
