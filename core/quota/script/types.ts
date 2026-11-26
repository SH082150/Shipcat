/**
 * 供应商额度查询的用户脚本契约。
 *
 * Shipcat 不内置任何供应商模板，也不与供应商绑定：
 * - 用户在 `queries.json` 里写一段脚本，绑定一个 providerId；
 * - 脚本通过 `ctx.apiKey / ctx.baseUrl` 拿到凭证，自己请求供应商接口；
 * - 脚本把结果归一成 5h / 7d / 30d 窗口或余额，交给 Shipcat 展示。
 *
 * 脚本形态：一段 JS，在受限上下文里执行，必须定义 `async function query(ctx)`。
 * 可用的全局仅有 `fetch`（Shipcat 提供）与 `console`（静默）。
 */

export type QuotaWindowKey = "5h" | "7d" | "30d";

export type QuotaWindowUnit = "tokens" | "requests" | "percent" | "currency";

/** 一个窗口的读数；至少给出一项，其余由 Shipcat 推导。 */
export interface QuotaWindowReading {
  readonly used?: number;
  readonly limit?: number;
  readonly remaining?: number;
  /** 窗口重置时间（epoch ms）；用户脚本自己决定是否提供。 */
  readonly resetAt?: number;
  readonly unit?: QuotaWindowUnit;
  readonly note?: string;
}

export interface QuotaBalanceReading {
  readonly amount: number;
  readonly currency: string;
  readonly note?: string;
}

/** 脚本返回值：窗口和/或余额，二者至少一项。 */
export interface QuotaQueryResult {
  readonly windows?: Partial<Record<QuotaWindowKey, QuotaWindowReading>>;
  readonly balance?: QuotaBalanceReading;
}

export interface QuotaHttpInit {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs?: number;
}

export interface QuotaHttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Readonly<Record<string, string>>;
  readonly url: string;
  readonly text: string;
  json<T = unknown>(): T;
}

export type QuotaFetch = (
  url: string,
  init?: QuotaHttpInit,
) => Promise<QuotaHttpResponse>;

export interface QuotaQueryContext {
  /** 该 provider 的密钥；脚本不要把它写入配置或日志。 */
  readonly apiKey: string;
  /** 该 provider 的 baseUrl，原样提供。 */
  readonly baseUrl: string;
  readonly providerId: string;
  readonly now: number;
  readonly fetch: QuotaFetch;
}

/** 脚本里定义的入口。 */
export type QuotaQueryFunction = (
  context: QuotaQueryContext,
) => QuotaQueryResult | Promise<QuotaQueryResult>;

export interface QuotaQueryOutcome {
  readonly queryId: string;
  readonly providerId: string;
  readonly ok: boolean;
  readonly fetchedAt: number;
  readonly result?: QuotaQueryResult;
  readonly error?: string;
}
