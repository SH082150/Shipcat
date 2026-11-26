/**
 * 执行用户额度查询脚本并归一结果。
 *
 * 沙箱只暴露 `fetch` 与静默 `console`；脚本必须定义 `async function query(ctx)`。
 * 脚本由用户自己编写，Shipcat 不注入任何供应商知识。
 */

import { spawn } from "node:child_process";
import { createContext, Script } from "node:vm";

import { getById } from "../../archive/providers/index.ts";
import { safeFetch } from "./http.ts";
import type {
  QuotaFetch,
  QuotaQueryContext,
  QuotaQueryFunction,
  QuotaQueryOutcome,
  QuotaQueryResult,
  QuotaWindowKey,
  QuotaWindowReading,
  QuotaWindowUnit,
} from "./types.ts";

const SCRIPT_TIMEOUT_MS = 5_000;
const QUERY_TIMEOUT_MS = 15_000;
const WINDOW_KEYS: readonly QuotaWindowKey[] = ["5h", "7d", "30d"];
const UNITS: readonly QuotaWindowUnit[] = ["tokens", "requests", "percent", "currency"];

function numberField(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label}必须是非负数字。`);
  }
  return value;
}

function normalizeWindow(value: unknown, key: QuotaWindowKey): QuotaWindowReading {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`windows.${key} 必须是对象。`);
  }
  const raw = value as Record<string, unknown>;
  let limit = numberField(raw.limit, `windows.${key}.limit`);
  let used = numberField(raw.used, `windows.${key}.used`);
  let remaining = numberField(raw.remaining, `windows.${key}.remaining`);
  const resetAt = numberField(raw.resetAt, `windows.${key}.resetAt`);
  if (resetAt !== undefined && resetAt > 8_640_000_000_000_000) {
    throw new Error(`windows.${key}.resetAt 超出可表示范围。`);
  }

  if (limit === undefined && used !== undefined && remaining !== undefined) {
    limit = used + remaining;
  }
  if (limit !== undefined) {
    if (remaining === undefined && used !== undefined) {
      remaining = Math.max(0, limit - used);
    } else if (used === undefined && remaining !== undefined) {
      used = Math.max(0, limit - remaining);
    }
  }

  const unit = raw.unit === undefined ? "tokens" : raw.unit;
  if (typeof unit !== "string" || !UNITS.includes(unit as QuotaWindowUnit)) {
    throw new Error(`windows.${key}.unit 不合法。`);
  }
  const note = typeof raw.note === "string" ? raw.note.slice(0, 200) : undefined;

  // 本地统计只看 resetAt，允许脚本只返回重置时间。
  if (
    used === undefined &&
    limit === undefined &&
    remaining === undefined &&
    resetAt === undefined
  ) {
    throw new Error(`windows.${key} 至少需要 used / limit / remaining / resetAt 之一。`);
  }
  return {
    ...(used === undefined ? {} : { used }),
    ...(limit === undefined ? {} : { limit }),
    ...(remaining === undefined ? {} : { remaining }),
    ...(resetAt === undefined ? {} : { resetAt }),
    unit: unit as QuotaWindowUnit,
    ...(note === undefined ? {} : { note }),
  };
}

/** 校验脚本返回值；窗口与余额至少存在一项。 */
export function normalizeQuotaResult(value: unknown): QuotaQueryResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("脚本必须返回对象。");
  }
  const raw = value as Record<string, unknown>;
  const windows: Partial<Record<QuotaWindowKey, QuotaWindowReading>> = {};
  if (raw.windows !== undefined) {
    if (raw.windows === null || typeof raw.windows !== "object" || Array.isArray(raw.windows)) {
      throw new Error("windows 必须是对象。");
    }
    const source = raw.windows as Record<string, unknown>;
    for (const key of WINDOW_KEYS) {
      if (source[key] !== undefined) windows[key] = normalizeWindow(source[key], key);
    }
  }

  let balance: QuotaQueryResult["balance"];
  if (raw.balance !== undefined) {
    if (raw.balance === null || typeof raw.balance !== "object" || Array.isArray(raw.balance)) {
      throw new Error("balance 必须是对象。");
    }
    const source = raw.balance as Record<string, unknown>;
    const amount = numberField(source.amount, "balance.amount");
    if (amount === undefined) throw new Error("balance.amount 必填。");
    const currency = typeof source.currency === "string" ? source.currency.slice(0, 16) : "";
    const note = typeof source.note === "string" ? source.note.slice(0, 200) : undefined;
    balance = {
      amount,
      currency,
      ...(note === undefined ? {} : { note }),
    };
  }

  if (Object.keys(windows).length === 0 && balance === undefined) {
    throw new Error("脚本必须返回至少一个窗口或 balance。");
  }
  return {
    ...(Object.keys(windows).length === 0 ? {} : { windows }),
    ...(balance === undefined ? {} : { balance }),
  };
}

export interface RunQuotaScriptOptions {
  readonly timeoutMs?: number;
  /** 仅测试注入：提供后改为进程内执行（不用于生产）。 */
  readonly fetch?: QuotaFetch;
}

const WORKER_SOURCE = String.raw`
const vm = require("node:vm");
const MAX_BODY = 1024 * 1024;
async function safeFetch(url, init) {
  init = init || {};
  let target;
  try { target = new URL(url); } catch { throw new Error("请求地址不合法"); }
  if (target.protocol !== "https:") throw new Error("额度查询只允许 HTTPS 地址。");
  const timeoutMs = Math.min(60000, Math.max(1000, Number(init.timeoutMs) || 10000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = target;
    let response;
    for (let hop = 0; hop < 5; hop += 1) {
      response = await fetch(current, {
        method: init.method || "GET",
        headers: init.headers,
        body: init.body,
        signal: controller.signal,
        redirect: "manual",
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) break;
        const next = new URL(location, current);
        if (next.protocol !== "https:") throw new Error("重定向到了非 HTTPS 地址。");
        current = next;
        continue;
      }
      break;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_BODY) throw new Error("响应体超过 1MB 上限");
    const text = buffer.toString("utf8");
    const headers = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    return {
      status: response.status,
      ok: response.ok,
      headers,
      url: response.url,
      text,
      json() { return JSON.parse(text); },
    };
  } finally {
    clearTimeout(timer);
  }
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  if (input.length > 2000000) process.exit(2);
});
process.stdin.on("end", async () => {
  try {
    const job = JSON.parse(input);
    const sandbox = { fetch: safeFetch, console: { log() {}, info() {}, warn() {}, error() {} } };
    const context = vm.createContext(sandbox);
    new vm.Script(job.script, { filename: "quota-script.js" }).runInContext(context, {
      timeout: job.scriptTimeoutMs,
    });
    if (typeof sandbox.query !== "function") {
      throw new Error("脚本必须定义 async function query(ctx)。");
    }
    const ctx = {
      apiKey: job.apiKey,
      baseUrl: job.baseUrl,
      providerId: job.providerId,
      now: job.now,
      fetch: safeFetch,
    };
    const result = await sandbox.query(ctx);
    process.stdout.write(JSON.stringify({ ok: true, result }));
  } catch (error) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error) }),
    );
  }
});
`;

function runInWorker(
  source: string,
  context: QuotaQueryContext,
  timeoutMs: number,
): Promise<QuotaQueryResult> {
  return new Promise<QuotaQueryResult>((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", WORKER_SOURCE], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "ignore"],
    });
    let output = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (error: Error | null, value?: QuotaQueryResult): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (error !== null) reject(error);
      else if (value !== undefined) resolve(value);
    };

    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`查询超时（${timeoutMs}ms）。`));
    }, timeoutMs);

    if (child.stdout === null) {
      finish(new Error("无法启动脚本进程。"));
      return;
    }
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 5_000_000) {
        child.kill("SIGKILL");
        finish(new Error("脚本输出超过上限。"));
      }
    });
    child.on("error", (error) => finish(error));
    child.on("close", () => {
      try {
        const parsed = JSON.parse(output) as { ok?: boolean; result?: unknown; error?: string };
        if (parsed.ok !== true) {
          finish(new Error(parsed.error ?? "脚本执行失败。"));
          return;
        }
        finish(null, normalizeQuotaResult(parsed.result));
      } catch {
        finish(new Error("脚本进程返回了无法解析的结果。"));
      }
    });

    if (child.stdin === null) {
      finish(new Error("无法写入脚本进程。"));
      return;
    }
    child.stdin.end(
      JSON.stringify({
        script: source,
        apiKey: context.apiKey,
        baseUrl: context.baseUrl,
        providerId: context.providerId,
        now: context.now,
        scriptTimeoutMs: SCRIPT_TIMEOUT_MS,
      }),
    );
  });
}

/** 在受限上下文执行脚本并归一结果；异常直接抛出。 */
export async function runQuotaScript(
  source: string,
  context: QuotaQueryContext,
  options: RunQuotaScriptOptions = {},
): Promise<QuotaQueryResult> {
  // 生产路径：独立子进程执行，超时直接 kill，脚本无法拿到主进程对象。
  if (options.fetch === undefined) {
    return runInWorker(source, context, options.timeoutMs ?? QUERY_TIMEOUT_MS);
  }

  // 测试路径：注入 fetch 便于断言请求；与生产隔离逻辑无关。
  const sandbox: Record<string, unknown> = {
    fetch: options.fetch,
    console: { log() {}, info() {}, warn() {}, error() {} },
  };
  const vmContext = createContext(sandbox);
  const script = new Script(source, { filename: "quota-script.js" });
  script.runInContext(vmContext, { timeout: options.timeoutMs ?? SCRIPT_TIMEOUT_MS });

  const query = sandbox.query;
  if (typeof query !== "function") {
    throw new Error("脚本必须定义 async function query(ctx)。");
  }
  const result = await withTimeout(
    Promise.resolve((query as QuotaQueryFunction)(context)),
    options.timeoutMs ?? QUERY_TIMEOUT_MS,
  );
  return normalizeQuotaResult(result);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`查询超时（${timeoutMs}ms）。`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface QueryProviderQuotaOptions {
  readonly home?: string;
  readonly now?: number;
  readonly fetch?: QuotaFetch;
  /** 测试注入；默认从 provider 库读取。 */
  readonly getProvider?: (id: string) => { baseUrl: string; apiKey: string };
}

/** 一条已加载的额度配置；由调用方从 limitprofiles 档案读取。 */
export interface QuotaQueryProfile {
  readonly id: string;
  readonly providerId: string;
  readonly script: string;
  readonly timeoutMs: number;
  readonly enabled: boolean;
}

/** 执行一条额度配置；错误归一成 outcome，不抛出。 */
export async function queryProfileQuota(
  profile: QuotaQueryProfile,
  options: QueryProviderQuotaOptions = {},
): Promise<QuotaQueryOutcome> {
  const now = options.now ?? Date.now();
  if (!profile.enabled) {
    return {
      queryId: profile.id,
      providerId: profile.providerId,
      ok: false,
      fetchedAt: now,
      error: "查询已禁用。",
    };
  }

  try {
    const provider = options.getProvider
      ? options.getProvider(profile.providerId)
      : (() => {
          const record = getById(
            profile.providerId,
            options.home === undefined ? undefined : { home: options.home },
          );
          return {
            baseUrl: record.inferenceGatewayBaseUrl,
            apiKey: record.inferenceGatewayApiKey,
          };
        })();
    const result = await runQuotaScript(
      profile.script,
      {
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        providerId: profile.providerId,
        now,
        fetch: options.fetch ?? safeFetch,
      },
      { timeoutMs: profile.timeoutMs, fetch: options.fetch ?? safeFetch },
    );
    return {
      queryId: profile.id,
      providerId: profile.providerId,
      ok: true,
      fetchedAt: now,
      result,
    };
  } catch (error) {
    return {
      queryId: profile.id,
      providerId: profile.providerId,
      ok: false,
      fetchedAt: now,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
