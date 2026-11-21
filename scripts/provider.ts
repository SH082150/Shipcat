/**
 * provider 命令组（scripts/provider.ts）。
 *
 * 四个子命令：add / list / remove / rename。只解析参数、调 core 公共
 * API（validate、providers，统一经 core/index 取货）、打印结果；不含
 * 业务逻辑。apiKey 展示一律打码。
 *
 * core 的 archive 函数是异步、无 per-call home 参数的；--home 由入口经
 * env CLAUDEHARBOR_HOME 注入（core 路径表缺省 resolveHome()；Windows 上
 * 主目录取 USERPROFILE，不读 Git Bash 的 HOME）。
 */

import type { MetaEntry } from "../core/types.ts";

/** 命令组公共选项：home 注入（由入口的全局 --home 传入，经 env CLAUDEHARBOR_HOME 生效）。 */
export interface ProviderCommandOptions {
  readonly home?: string;
}

/** 校验函数的统一返回（与 core/validate 一致：通过或中文修复提示）。 */
type ValidationResult = { ok: true } | { ok: false; message: string };

/** 鉴权方案：与 Provider.inferenceGatewayAuthScheme 同枚举。 */
type AuthScheme = "x-api-key" | "bearer";

/** 供应商详情（core 的 ProviderInfo）：_meta 条目 + 三件套（apiKey 明文，CLI 负责打码）。 */
interface ProviderInfo extends MetaEntry {
  readonly inferenceGatewayBaseUrl: string;
  readonly inferenceGatewayApiKey: string;
  readonly inferenceGatewayAuthScheme: AuthScheme;
}

/** add 的输入（authScheme 缺省 x-api-key，与 core 一致）。 */
interface AddProviderInput {
  readonly name: string;
  readonly inferenceGatewayBaseUrl: string;
  readonly inferenceGatewayApiKey: string;
  readonly inferenceGatewayAuthScheme?: AuthScheme;
}

interface ProvidersApi {
  add(input: AddProviderInput): Promise<MetaEntry>;
  list(): Promise<MetaEntry[]>;
  getByName(name: string): Promise<ProviderInfo | null>;
  rename(oldName: string, newName: string): Promise<MetaEntry>;
  remove(name: string): Promise<void>;
}

/** core/index 汇总出口里本命令组用到的公共 API 面。 */
interface CoreFacade {
  validateProviderName(name: string, existingNames: readonly string[]): ValidationResult;
  validateBaseUrl(url: string): ValidationResult;
  providers: ProvidersApi;
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
 * 惰性加载 core/index 并适配导出形状（扁平导出或 archive.<ns> 命名空间
 * 均可）；查询路径集中在此，导出形状变化时只需改这一个函数。
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

  const validateNs = pick(mod, "validate");
  const archiveNs = pick(mod, "archive");
  const facade: CoreFacade = {
    validateProviderName: (pick(mod, "validateProviderName") ?? pick(validateNs, "validateProviderName")) as CoreFacade["validateProviderName"],
    validateBaseUrl: (pick(mod, "validateBaseUrl") ?? pick(validateNs, "validateBaseUrl")) as CoreFacade["validateBaseUrl"],
    providers: (pick(mod, "providers") ?? pick(archiveNs, "providers")) as ProvidersApi,
  };
  if (
    typeof facade.validateProviderName !== "function" ||
    typeof facade.validateBaseUrl !== "function" ||
    typeof facade.providers?.add !== "function" ||
    typeof facade.providers?.list !== "function" ||
    typeof facade.providers?.getByName !== "function" ||
    typeof facade.providers?.rename !== "function" ||
    typeof facade.providers?.remove !== "function"
  ) {
    throw new Error("内核接口缺失：core/index 的导出形状不符合预期");
  }
  return facade;
}

/** 密钥打码：≤6 字符全遮；否则保留前 4 后 2，中间用省略号（安全要求：展示不得泄露完整 apiKey）。 */
export function maskApiKey(key: string): string {
  if (key.length <= 6) return "****";
  return `${key.slice(0, 4)}…${key.slice(-2)}`;
}

/** 终端对齐用的显示宽度：CJK 全角记 2 列。 */
function displayWidth(s: string): number {
  let width = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    width +=
      (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
      (cp >= 0x2e80 && cp <= 0x303e) || // CJK 部首、注音
      (cp >= 0x3041 && cp <= 0x33ff) || // 假名、CJK 符号
      (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 扩展 A
      (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 基本
      (cp >= 0xa000 && cp <= 0xa4cf) || // 彝文
      (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul 音节
      (cp >= 0xf900 && cp <= 0xfaff) || // CJK 兼容表意
      (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK 兼容形式
      (cp >= 0xff00 && cp <= 0xff60) || // 全角 ASCII
      (cp >= 0x20000 && cp <= 0x3fffd) // CJK 扩展 B 及以上
        ? 2
        : 1;
  }
  return width;
}

function padRight(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - displayWidth(s)));
}

/** 简单表格：首行为表头，列间两个空格。 */
export function printTable(headers: readonly string[], rows: readonly (readonly string[])[]): void {
  const widths = headers.map((h, i) =>
    Math.max(displayWidth(h), ...rows.map((r) => displayWidth(r[i] ?? "")))
  );
  const render = (cells: readonly string[]) =>
    cells.map((c, i) => padRight(c, widths[i] ?? displayWidth(c))).join("  ").trimEnd();
  console.log(render(headers));
  for (const row of rows) console.log(render(row));
}

const USAGE = `用法：
  claudeharbor provider add <名称> <baseUrl> <密钥> [authScheme]   添加供应商
  claudeharbor provider list                                       列出供应商
  claudeharbor provider remove <名称>                              删除供应商
  claudeharbor provider rename <旧名> <新名>                       改显示名
`;

function usageError(message: string): number {
  console.error(`错误：${message}`);
  console.error(USAGE);
  return 2;
}

async function cmdAdd(args: readonly string[], opts: ProviderCommandOptions): Promise<number> {
  if (args.length < 3 || args.length > 4) {
    return usageError("provider add 需要 3–4 个参数：<名称> <baseUrl> <密钥> [authScheme]");
  }
  const [name, baseUrl, apiKey, schemeArg] = args as [string, string, string, string | undefined];
  const authScheme = schemeArg ?? "x-api-key";
  if (authScheme !== "x-api-key" && authScheme !== "bearer") {
    return usageError(`authScheme 只支持 x-api-key 或 bearer，收到 "${authScheme}"`);
  }
  void opts; // home 已由入口经 env CLAUDEHARBOR_HOME 注入

  const core = await loadCore();
  const existingNames = (await core.providers.list()).map((e) => e.name);
  const nameCheck = core.validateProviderName(name, existingNames);
  if (!nameCheck.ok) {
    console.error(`错误：${nameCheck.message}`);
    return 1;
  }
  const urlCheck = core.validateBaseUrl(baseUrl.replace(/\/+$/, ""));
  if (!urlCheck.ok) {
    console.error(`错误：${urlCheck.message}`);
    return 1;
  }

  const entry = await core.providers.add({
    name,
    inferenceGatewayBaseUrl: baseUrl,
    inferenceGatewayApiKey: apiKey,
    inferenceGatewayAuthScheme: authScheme,
  });
  console.log(`已添加供应商「${entry.name}」（${entry.id}）`);
  return 0;
}

async function cmdList(args: readonly string[], opts: ProviderCommandOptions): Promise<number> {
  if (args.length !== 0) {
    return usageError("provider list 不接收额外参数");
  }
  void opts; // home 已由入口经 env CLAUDEHARBOR_HOME 注入
  const core = await loadCore();
  const entries = await core.providers.list();
  if (entries.length === 0) {
    console.log("（供应商库为空，先用 claudeharbor provider add 添加）");
    return 0;
  }
  const rows: string[][] = [];
  for (const entry of entries) {
    let info: ProviderInfo | null = null;
    try {
      info = await core.providers.getByName(entry.name);
    } catch {
      // 索引在而档案损坏（ARCHIVE_CORRUPT）：该行其余列以 - 占位。
    }
    rows.push([
      entry.name,
      entry.id,
      info?.inferenceGatewayAuthScheme ?? "-",
      info === null ? "-" : maskApiKey(info.inferenceGatewayApiKey),
    ]);
  }
  printTable(["名称", "UUID", "认证方式", "密钥"], rows);
  return 0;
}

async function cmdRemove(args: readonly string[], opts: ProviderCommandOptions): Promise<number> {
  if (args.length !== 1) {
    return usageError("provider remove 需要 1 个参数：<名称>");
  }
  void opts;
  const core = await loadCore();
  await core.providers.remove(args[0] as string);
  console.log(`已删除供应商「${args[0] as string}」`);
  return 0;
}

async function cmdRename(args: readonly string[], opts: ProviderCommandOptions): Promise<number> {
  if (args.length !== 2) {
    return usageError("provider rename 需要 2 个参数：<旧名> <新名>");
  }
  void opts;
  const core = await loadCore();
  const entry = await core.providers.rename(args[0] as string, args[1] as string);
  console.log(`已将供应商「${args[0] as string}」改名为「${entry.name}」`);
  return 0;
}

/** provider 命令组入口：由 claudeharbor.ts 分发调用，返回退出码。 */
export async function runProvider(
  args: readonly string[],
  opts: ProviderCommandOptions = {},
): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
    case "--help":
    case "-h":
    case "help":
      console.log(USAGE);
      return 0;
    case "add":
      return cmdAdd(rest, opts);
    case "list":
      return cmdList(rest, opts);
    case "remove":
      return cmdRemove(rest, opts);
    case "rename":
      return cmdRename(rest, opts);
    default:
      return usageError(`未知子命令 "provider ${sub}"`);
  }
}
