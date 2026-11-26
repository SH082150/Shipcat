/**
 * 供应商列表与详情页。纯渲染：不读取 core、不发请求；默认展示演示数据，
 * 接入时通过 `render(context, { providers })` 与 `renderDetail(context, id, detail)` 注入。
 */

import { escapeHtml, iconSlot } from "../components/html.ts";
import { iconSvg } from "../components/icons.ts";
import type { LimitProfileDetailDto } from "../../shared/ipc.ts";
import type { PageContext } from "./types.ts";

export type ProviderAuthScheme = "x-api-key" | "bearer";

/** 列表行需要的最小数据：对齐 core Provider + _meta 的 id/name。 */
export interface ProviderView {
  readonly id: string;
  readonly name: string;
  readonly inferenceGatewayBaseUrl: string;
  readonly inferenceGatewayAuthScheme: ProviderAuthScheme;
}

/** 详情页额外携带明文密钥；由调用方注入，页面本身不持久化任何数据。 */
export interface ProviderDetail extends ProviderView {
  readonly inferenceGatewayApiKey: string;
}

export interface ProvidersPageOptions {
  readonly providers?: readonly ProviderView[];
}

export const DEMO_PROVIDERS: readonly ProviderView[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic",
    inferenceGatewayAuthScheme: "x-api-key",
  },
  {
    id: "kimi",
    name: "Kimi",
    inferenceGatewayBaseUrl: "https://api.moonshot.cn/anthropic",
    inferenceGatewayAuthScheme: "bearer",
  },
  {
    id: "glm",
    name: "GLM",
    inferenceGatewayBaseUrl: "https://open.bigmodel.cn/api/anthropic",
    inferenceGatewayAuthScheme: "x-api-key",
  },
];

interface ProvidersText {
  readonly search: string;
  readonly closeSearch: string;
  readonly listLabel: string;
  readonly back: string;
  readonly detailDescription: string;
  readonly sectionConnection: string;
  readonly nameLabel: string;
  readonly nameHint: string;
  readonly baseUrlLabel: string;
  readonly baseUrlHint: string;
  readonly apiKeyLabel: string;
  readonly apiKeyHint: string;
  readonly authLabel: string;
  readonly authHint: string;
  readonly schemeApiKey: string;
  readonly schemeBearer: string;
  readonly authApiKeyHeader: string;
  readonly authBearerToken: string;
  readonly save: string;
  readonly createTitle: string;
  readonly createAction: string;
  readonly namePlaceholder: string;
  readonly delete: string;
  readonly notFoundTitle: string;
  readonly notFoundBody: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly limitTitle: string;
  readonly limitDescription: string;
  readonly limitNameLabel: string;
  readonly limitEnabled: string;
  readonly limitTimeoutLabel: string;
  readonly limitScriptLabel: string;
  readonly limitScriptHint: string;
  readonly limitTest: string;
  readonly limitSave: string;
  readonly limitDelete: string;
}

const EN_TEXT: ProvidersText = {
  search: "Search providers",
  closeSearch: "Close search",
  listLabel: "Provider list",
  back: "Providers",
  detailDescription:
    "Configure the address, key and authentication scheme the local gateway uses for this provider.",
  sectionConnection: "Connection",
  nameLabel: "Name",
  nameHint: "Shown when this provider is referenced from a profile.",
  baseUrlLabel: "Base URL",
  baseUrlHint: "An Anthropic-compatible endpoint. The gateway forwards requests here.",
  apiKeyLabel: "API key",
  apiKeyHint: "Stored on this machine only; the interface never reveals it.",
  authLabel: "Authentication",
  authHint: "Sets the header the gateway uses when sending the key upstream.",
  schemeApiKey: "API Key",
  schemeBearer: "Bearer",
  authApiKeyHeader: "API key header",
  authBearerToken: "Bearer token",
  save: "Save",
  createTitle: "Add provider",
  createAction: "Add",
  namePlaceholder: "e.g. deepseek",
  delete: "Delete provider",
  notFoundTitle: "Provider not found",
  notFoundBody: "It may have been deleted, or the link is no longer valid.",
  emptyTitle: "No providers yet",
  emptyBody: "Add a provider and it will appear here.",
  limitTitle: "Limit query",
  limitDescription:
    "Optional. Write a script to query this provider's quota. Shipcat ships no vendor templates and never stores keys in the script config.",
  limitNameLabel: "Name",
  limitEnabled: "Enabled",
  limitTimeoutLabel: "Timeout (ms)",
  limitScriptLabel: "Script",
  limitScriptHint:
    "Use ctx.apiKey / ctx.baseUrl / ctx.fetch; return windows (5h / 7d / 30d) and/or balance.",
  limitTest: "Test",
  limitSave: "Save",
  limitDelete: "Delete query",
};

const ZH_TEXT: ProvidersText = {
  search: "搜索供应商",
  closeSearch: "关闭搜索",
  listLabel: "供应商列表",
  back: "供应商",
  detailDescription: "配置本地网关连接这家供应商时使用的地址、密钥与认证方式。",
  sectionConnection: "连接",
  nameLabel: "名称",
  nameHint: "在档案中引用这家供应商时显示的名字。",
  baseUrlLabel: "Base URL",
  baseUrlHint: "Anthropic 兼容端点，网关会把请求转发到这里。",
  apiKeyLabel: "API Key",
  apiKeyHint: "只保存在这台机器上；界面不会回显明文。",
  authLabel: "认证方式",
  authHint: "决定网关向上游发送密钥时使用的请求头。",
  schemeApiKey: "API Key",
  schemeBearer: "Bearer",
  authApiKeyHeader: "API Key 请求头",
  authBearerToken: "Bearer Token",
  save: "保存",
  createTitle: "添加供应商",
  createAction: "添加",
  namePlaceholder: "例如 deepseek",
  delete: "删除供应商",
  notFoundTitle: "找不到这家供应商",
  notFoundBody: "它可能已被删除，或链接已经失效。",
  emptyTitle: "还没有供应商",
  emptyBody: "添加一家供应商后，它会出现在这里。",
  limitTitle: "额度查询",
  limitDescription:
    "可选。写一段脚本查询这家供应商的额度；Shipcat 不内置供应商模板，也不会把密钥写进脚本配置。",
  limitNameLabel: "名称",
  limitEnabled: "启用",
  limitTimeoutLabel: "超时（毫秒）",
  limitScriptLabel: "脚本",
  limitScriptHint:
    "可用 ctx.apiKey / ctx.baseUrl / ctx.fetch；返回 windows（5h / 7d / 30d）和/或 balance。",
  limitTest: "测试",
  limitSave: "保存",
  limitDelete: "删除查询",
};

const TEXT: Record<PageContext["language"], ProvidersText> = {
  zh: ZH_TEXT,
  en: EN_TEXT,
};

function textFor(context: PageContext): ProvidersText {
  return TEXT[context.language] ?? EN_TEXT;
}

function renderRow(provider: ProviderView, strings: ProvidersText): string {
  const scheme =
    provider.inferenceGatewayAuthScheme === "bearer" ? strings.schemeBearer : strings.schemeApiKey;
  const id = escapeHtml(provider.id);
  return `<li class="pv-row" data-role="provider-row">
    <button type="button" class="pv-row-button" data-action="open-provider" data-provider-id="${id}">
      <span class="pv-row-copy">
        <span class="pv-row-name">${escapeHtml(provider.name)}</span>
        <span class="pv-row-url">${escapeHtml(provider.inferenceGatewayBaseUrl)}</span>
      </span>
      <span class="pv-row-scheme">${escapeHtml(scheme)}</span>
      ${iconSvg("chevron-right", "pv-icon pv-chevron")}
    </button>
  </li>`;
}

function renderEmpty(strings: ProvidersText): string {
  return `<section class="pv-empty" data-role="providers-empty">
    ${iconSlot("pv-icon pv-empty-icon")}
    <h2>${escapeHtml(strings.emptyTitle)}</h2>
    <p>${escapeHtml(strings.emptyBody)}</p>
  </section>`;
}

export function render(context: PageContext, options: ProvidersPageOptions = {}): string {
  const strings = textFor(context);
  const providers = options.providers ?? DEMO_PROVIDERS;
  const list =
    providers.length === 0
      ? renderEmpty(strings)
      : `<ul class="pv-list" data-role="provider-list" aria-label="${escapeHtml(strings.listLabel)}">${providers
          .map((provider) => renderRow(provider, strings))
          .join("")}</ul>`;

  return `<article class="page page--providers" data-role="page-providers">
    <header class="pv-head">
      <div class="pv-head-copy">
        <h1>${escapeHtml(context.t.t("providers.title"))}</h1>
        <p class="pv-lede">${escapeHtml(context.t.t("providers.description"))}</p>
      </div>
      <div class="pv-head-actions">
        <div class="pv-search" data-role="page-search" data-page-search data-open="false">
          <button type="button" class="pv-search-toggle" data-action="search-providers" aria-label="${escapeHtml(strings.search)}" title="${escapeHtml(strings.search)}">${iconSvg("search", "pv-icon pv-search-icon")}</button>
          <div class="pv-search-field">
            ${iconSvg("search", "pv-icon pv-search-icon")}
            <input
              type="search"
              data-role="provider-search"
              placeholder="${escapeHtml(strings.search)}"
              aria-label="${escapeHtml(strings.search)}"
              autocomplete="off"
              spellcheck="false"
            />
            <button type="button" class="pv-search-close" data-action="search-toggle" aria-label="${escapeHtml(strings.closeSearch)}">${iconSvg("close", "pv-icon pv-search-close-icon")}</button>
          </div>
        </div>
        <button type="button" class="pv-button pv-button--primary" data-action="add-provider">
          ${iconSvg("plus", "pv-icon pv-add-icon")}<span>${escapeHtml(context.t.t("providers.add"))}</span>
        </button>
      </div>
    </header>

    <div class="pv-toolbar" aria-hidden="true"></div>

    ${list}
  </article>`;
}

function renderSchemeOption(
  value: ProviderAuthScheme,
  active: ProviderAuthScheme,
  strings: ProvidersText,
): string {
  const checked = value === active ? " checked" : "";
  const label = value === "bearer" ? strings.authBearerToken : strings.authApiKeyHeader;
  return `<label class="pv-scheme-option">
    <input
      type="radio"
      name="inferenceGatewayAuthScheme"
      value="${value}"
      data-auth-scheme="${value}"${checked}
    />
    <span>${escapeHtml(label)}</span>
  </label>`;
}

function renderMissing(id: string, strings: ProvidersText): string {
  return `<article class="page page--provider-detail" data-role="page-provider-detail" data-provider-id="${escapeHtml(id)}">
    <div class="pv-topbar">
      <button type="button" class="pv-back" data-page="providers">
        ${iconSvg("back", "pv-icon pv-back-icon")}<span>${escapeHtml(strings.back)}</span>
      </button>
    </div>

    <section class="pv-missing" data-role="provider-detail-missing">
      ${iconSlot("pv-icon pv-missing-icon")}
      <h1>${escapeHtml(strings.notFoundTitle)}</h1>
      <p>${escapeHtml(strings.notFoundBody)}</p>
    </section>
  </article>`;
}

/** 创建模式使用的虚拟 id：路由 #providers/new。 */
export const PROVIDER_CREATE_ID = "new";

function renderLimitSection(
  context: PageContext,
  providerId: string,
  providerName: string,
  profile: LimitProfileDetailDto | null,
): string {
  const strings = textFor(context);
  const name = profile?.name ?? providerName;
  const script = profile?.script ?? "";
  const timeoutMs = profile?.timeoutMs ?? 8000;
  const enabled = profile?.enabled !== false;
  return `<section class="pv-form pv-limit" data-role="limit-profile-form" data-provider-id="${providerId}" data-limit-profile-id="${profile?.id ?? ""}">
      <h2 class="pv-form-title">${escapeHtml(strings.limitTitle)}</h2>
      <p class="pv-hint pv-limit-note">${escapeHtml(strings.limitDescription)}</p>

      <div class="pv-field">
        <label class="pv-field-label" for="pv-limit-name">${escapeHtml(strings.limitNameLabel)}</label>
        <div class="pv-field-body">
          <input class="pv-input" id="pv-limit-name" data-role="limit-name" type="text" value="${escapeHtml(name)}" autocomplete="off" spellcheck="false" />
        </div>
      </div>

      <div class="pv-field">
        <span class="pv-field-label">${escapeHtml(strings.limitScriptLabel)}</span>
        <div class="pv-field-body">
          <textarea class="pv-textarea" data-role="limit-script" rows="10" spellcheck="false" placeholder="async function query(ctx) {&#10;  const res = await ctx.fetch(...);&#10;  return { windows: { &quot;5h&quot;: { used: 0, limit: 0 } } };&#10;}">${escapeHtml(script)}</textarea>
          <p class="pv-hint">${escapeHtml(strings.limitScriptHint)}</p>
        </div>
      </div>

      <div class="pv-field">
        <span class="pv-field-label">${escapeHtml(strings.limitEnabled)}</span>
        <div class="pv-field-body pv-limit-options">
          <label class="pv-check pv-check--compact">
            <input type="checkbox" data-role="limit-enabled"${enabled ? " checked" : ""} />
          </label>
          <label class="pv-limit-timeout">
            <span>${escapeHtml(strings.limitTimeoutLabel)}</span>
            <input class="pv-input pv-input--short" data-role="limit-timeout" type="number" min="500" max="60000" step="500" value="${timeoutMs}" />
          </label>
        </div>
      </div>

      <div class="pv-limit-actions">
        <button type="button" class="pv-button" data-action="test-limit-profile">${escapeHtml(strings.limitTest)}</button>
        <button type="button" class="pv-button pv-button--primary" data-action="save-limit-profile">${escapeHtml(strings.limitSave)}</button>
        ${profile === null
          ? ""
          : `<button type="button" class="pv-danger pv-limit-delete" data-action="delete-limit-profile" data-limit-profile-id="${profile.id}">${escapeHtml(strings.limitDelete)}</button>`}
      </div>
      <p class="pv-limit-result" data-role="limit-result" hidden></p>
    </section>`;
}

export function renderDetail(
  context: PageContext,
  id: string,
  detail?: ProviderDetail | null,
  limitProfile?: LimitProfileDetailDto | null,
): string {
  const strings = textFor(context);
  const creating = id === PROVIDER_CREATE_ID;
  const provider = creating ? null : (detail ?? null);
  if (!creating && !provider) return renderMissing(id, strings);

  const scheme: ProviderAuthScheme =
    provider?.inferenceGatewayAuthScheme === "bearer" ? "bearer" : "x-api-key";
  const providerId = escapeHtml(creating ? PROVIDER_CREATE_ID : id);
  const title = creating ? strings.createTitle : (provider?.name ?? "");
  const saveLabel = creating ? strings.createAction : strings.save;

  return `<article class="page page--provider-detail${creating ? " page--provider-add" : ""}" data-role="${creating ? "page-provider-add" : "page-provider-detail"}" data-provider-id="${providerId}">
    <div class="pv-topbar">
      <button type="button" class="pv-back" data-page="providers">
        ${iconSvg("back", "pv-icon pv-back-icon")}<span>${escapeHtml(strings.back)}</span>
      </button>
      ${creating ? "" : `<button type="button" class="pv-danger" data-action="delete-provider" data-provider-id="${providerId}">
        ${iconSvg("trash", "pv-icon pv-trash-icon")}<span>${escapeHtml(strings.delete)}</span>
      </button>`}
    </div>

    <header class="pv-detail-head">
      <h1>${escapeHtml(title)}</h1>
      <p class="pv-lede">${escapeHtml(strings.detailDescription)}</p>
    </header>

    <section class="pv-form" data-role="provider-form" data-provider-id="${providerId}" aria-label="${escapeHtml(strings.sectionConnection)}">
      <h2 class="pv-form-title">${escapeHtml(strings.sectionConnection)}</h2>

      <div class="pv-field">
        <label class="pv-field-label" for="pv-provider-name">${escapeHtml(strings.nameLabel)}</label>
        <div class="pv-field-body">
          <input
            class="pv-input"
            id="pv-provider-name"
            name="name"
            type="text"
            value="${escapeHtml(provider?.name ?? "")}"
            placeholder="${escapeHtml(strings.namePlaceholder)}"
            autocomplete="off"
            spellcheck="false"
          />
          <p class="pv-hint">${escapeHtml(strings.nameHint)}</p>
        </div>
      </div>

      <div class="pv-field">
        <label class="pv-field-label" for="pv-provider-base-url">${escapeHtml(strings.baseUrlLabel)}</label>
        <div class="pv-field-body">
          <input
            class="pv-input pv-input--url"
            id="pv-provider-base-url"
            name="inferenceGatewayBaseUrl"
            type="url"
            inputmode="url"
            value="${escapeHtml(provider?.inferenceGatewayBaseUrl ?? "")}"
            placeholder="https://api.example.com/anthropic"
            autocomplete="off"
            spellcheck="false"
          />
          <p class="pv-hint">${escapeHtml(strings.baseUrlHint)}</p>
        </div>
      </div>

      <div class="pv-field">
        <label class="pv-field-label" for="pv-provider-api-key">${escapeHtml(strings.apiKeyLabel)}</label>
        <div class="pv-field-body">
          <input
            class="pv-input"
            id="pv-provider-api-key"
            name="inferenceGatewayApiKey"
            type="password"
            value="${escapeHtml(provider?.inferenceGatewayApiKey ?? "")}"
            autocomplete="new-password"
            spellcheck="false"
          />
          <p class="pv-hint">${escapeHtml(strings.apiKeyHint)}</p>
        </div>
      </div>

      <div class="pv-field">
        <span class="pv-field-label" id="pv-auth-label">${escapeHtml(strings.authLabel)}</span>
        <div class="pv-field-body">
          <div class="pv-scheme" role="radiogroup" aria-labelledby="pv-auth-label">
            ${renderSchemeOption("x-api-key", scheme, strings)}
            ${renderSchemeOption("bearer", scheme, strings)}
          </div>
          <p class="pv-hint">${escapeHtml(strings.authHint)}</p>
        </div>
      </div>
    </section>

    ${creating ? "" : renderLimitSection(context, providerId, provider?.name ?? "", limitProfile ?? null)}

    <div class="pv-savebar" data-role="provider-savebar">
      <button type="button" class="pv-button pv-button--primary" data-action="${creating ? "create-provider" : "save-provider"}" data-provider-id="${providerId}">
        <span>${escapeHtml(saveLabel)}</span>
      </button>
    </div>
  </article>`;
}
