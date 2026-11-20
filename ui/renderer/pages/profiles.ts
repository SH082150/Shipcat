/**
 * 档案页：列表、详情与字段弹窗。
 *
 * 路由约定：#profiles 渲染列表，#profiles/:id 由宿主调用 renderDetail。
 * 样式由同目录 profiles.css 提供，需由宿主页面引入。
 */

import { escapeHtml } from "../components/html.ts";
import { iconSvg } from "../components/icons.ts";
import { DEMO_PROVIDERS } from "./providers.ts";
import type { Language } from "../components/i18n.ts";
import type { PageContext } from "./types.ts";

export type ProfileMode = "standard" | "readOnly" | "advanced";
export type GatewayAuthScheme = "x-api-key" | "bearer";
export type ModelTier = "haiku" | "sonnet" | "opus" | "fable" | "mythos";
export type MaxEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** 模型条目的展示模型：键名贴近 core 的 ModelEntry / AdvancedModelEntry。 */
export interface ProfileModelDraft {
  readonly name: string;
  readonly labelOverride?: string;
  readonly provider?: string;
  readonly providerName?: string;
  readonly upstreamModel?: string;
  readonly supports1m?: boolean;
  readonly prefer1m?: boolean;
  readonly anthropicFamilyTier?: ModelTier;
  readonly isFamilyDefault?: boolean;
  readonly behavesAs?: string;
  readonly maxEffort?: MaxEffort;
}

/**
 * 单个配置档案的展示模型；name 对应 meta entries[].name，不另设配置名称。
 * 正式接线由主进程通过 IPC 调用 core/index.ts，再映射到此结构；渲染器不直接读文件。
 */
export interface ProfileDraft {
  readonly id: string;
  readonly name: string;
  readonly mode: ProfileMode;
  readonly applied: boolean;
  readonly port?: number;
  readonly gatewayToken?: string;
  readonly gatewayAuthScheme?: GatewayAuthScheme;
  readonly models?: readonly ProfileModelDraft[];
  readonly claude?: Record<string, unknown>;
}

export interface ProviderOption {
  readonly id: string;
  readonly name: string;
}

export interface ProfilesDemo {
  readonly activeId: string | null;
  readonly gatewayEnabled: boolean;
  readonly profiles: readonly ProfileDraft[];
  /** 供应商下拉选项；缺省使用演示供应商。 */
  readonly providers?: readonly ProviderOption[];
}

/** 宿主引入 stylesheet 时使用的相对路径（相对 ui/renderer/index.html）。 */
export const PROFILES_STYLESHEET = "pages/profiles.css";

const STANDARD_PROFILE: ProfileDraft = {
  id: "prf-standard",
  name: "Claude 官方直连",
  mode: "standard",
  applied: false,
  models: [
    {
      name: "claude-sonnet-main",
      labelOverride: "Sonnet 主力",
      providerName: "Anthropic 官方",
      anthropicFamilyTier: "sonnet",
      isFamilyDefault: true,
      supports1m: true,
      maxEffort: "high",
    },
    {
      name: "claude-haiku-fast",
      labelOverride: "Haiku 快速",
      providerName: "Anthropic 官方",
      anthropicFamilyTier: "haiku",
      maxEffort: "low",
    },
  ],
};

const ADVANCED_PROFILE: ProfileDraft = {
  id: "prf-gateway",
  name: "DeepSeek 网关",
  mode: "advanced",
  applied: true,
  port: 4318,
  gatewayToken: "harbor-demo-token",
  gatewayAuthScheme: "bearer",
  models: [
    {
      name: "claude-sonnet-gateway",
      labelOverride: "DeepSeek 主力",
      providerName: "DeepSeek",
      upstreamModel: "deepseek-chat",
      anthropicFamilyTier: "sonnet",
      isFamilyDefault: true,
      supports1m: true,
      prefer1m: true,
      behavesAs: "claude-sonnet-4-5",
      maxEffort: "max",
    },
    {
      name: "claude-opus-gateway",
      labelOverride: "DeepSeek 推理",
      providerName: "DeepSeek",
      upstreamModel: "deepseek-reasoner",
      anthropicFamilyTier: "opus",
      behavesAs: "claude-opus-4-1",
      maxEffort: "xhigh",
    },
  ],
};

const READONLY_PROFILE: ProfileDraft = {
  id: "prf-shared",
  name: "团队共享（只读）",
  mode: "readOnly",
  applied: false,
  models: [
    {
      name: "claude-team-sonnet",
      labelOverride: "团队 Sonnet",
      anthropicFamilyTier: "sonnet",
    },
    {
      name: "claude-team-opus",
      labelOverride: "团队 Opus",
      anthropicFamilyTier: "opus",
    },
  ],
};

const BACKUP_PROFILE: ProfileDraft = {
  id: "prf-qwen",
  name: "Qwen 备用网关",
  mode: "advanced",
  applied: false,
  port: 4319,
  gatewayToken: "harbor-demo-backup",
  gatewayAuthScheme: "x-api-key",
  models: [
    {
      name: "claude-qwen-main",
      labelOverride: "Qwen 主力",
      providerName: "通义千问",
      upstreamModel: "qwen3-max",
      anthropicFamilyTier: "sonnet",
      maxEffort: "high",
    },
  ],
};

export const demoProfiles: ProfilesDemo = {
  activeId: ADVANCED_PROFILE.id,
  gatewayEnabled: true,
  profiles: [STANDARD_PROFILE, ADVANCED_PROFILE, READONLY_PROFILE, BACKUP_PROFILE],
};

interface Copy {
  readonly title: string;
  readonly subtitle: string;
  readonly search: string;
  readonly closeSearch: string;
  readonly sort: string;
  readonly create: string;
  readonly activeLabel: string;
  readonly activated: string;
  readonly notActivated: string;
  readonly statusReadOnly: string;
  readonly listName: string;
  readonly status: string;
  readonly openProfile: string;
  readonly type: string;
  readonly mode: string;
  readonly applied: string;
  readonly apply: string;
  readonly gateway: string;
  readonly gatewaySwitch: string;
  readonly running: string;
  readonly paused: string;
  readonly port: string;
  readonly gatewayToken: string;
  readonly authScheme: string;
  readonly back: string;
  readonly addField: string;
  readonly basicInfo: string;
  readonly models: string;
  readonly addModel: string;
  readonly save: string;
  readonly saveNote: string;
  readonly readOnlyNote: string;
  readonly note: string;
  readonly fieldTitle: string;
  readonly fieldHint: string;
  readonly fieldKey: string;
  readonly fieldValue: string;
  readonly fieldKeyPlaceholder: string;
  readonly fieldValuePlaceholder: string;
  readonly cancel: string;
  readonly add: string;
  readonly requiredKey: string;
  readonly notFoundTitle: string;
  readonly notFoundBody: string;
  readonly modelId: string;
  readonly labelOverride: string;
  readonly provider: string;
  readonly upstreamModel: string;
  readonly supports1m: string;
  readonly prefer1m: string;
  readonly familyTier: string;
  readonly familyDefault: string;
  readonly behavesAs: string;
  readonly maxEffort: string;
  readonly countSuffix: string;
  readonly createTitle: string;
  readonly createDescription: string;
  readonly createAction: string;
  readonly chooseProvider: string;
  readonly untitledModel: string;
  readonly removeModel: string;
  readonly claudeFields: string;
  readonly claudeEmpty: string;
  readonly deleteProfile: string;
  readonly namePlaceholder: string;
  readonly modeLabels: Record<ProfileMode, string>;
}

const COPY: Record<Language, Copy> = {
  zh: {
    title: "档案",
    subtitle: "管理 Claude Desktop 的配置文件、模型映射与网关路由。",
    search: "搜索配置",
    closeSearch: "关闭搜索",
    sort: "排序",
    create: "添加配置文件",
    activeLabel: "当前激活配置",
    activated: "已激活",
    notActivated: "未激活",
    statusReadOnly: "只读",
    listName: "名称",
    status: "状态",
    openProfile: "打开配置",
    type: "Type",
    mode: "模式",
    applied: "激活",
    apply: "应用",
    gateway: "本地网关",
    gatewaySwitch: "网关开关",
    running: "运行中",
    paused: "已暂停",
    port: "端口",
    gatewayToken: "网关 Token",
    authScheme: "鉴权方案",
    back: "返回",
    addField: "添加条目",
    basicInfo: "基本信息",
    models: "模型",
    addModel: "添加模型",
    save: "保存修改",
    saveNote: "原型数据 · 不会写入 core",
    readOnlyNote: "只读配置 · 所有字段不可编辑",
    note: "演示数据集中在 demoProfiles，接入 core 时替换数据源即可。",
    fieldTitle: "添加条目",
    fieldHint: "选择或输入 Claude 透传字段；布尔填 true/false，JSON 直接粘贴。",
    fieldKey: "项目",
    fieldValue: "值",
    fieldKeyPlaceholder: "例如 modelCatalogUrl",
    fieldValuePlaceholder: "例如 https://…",
    cancel: "取消",
    add: "添加",
    requiredKey: "请填写项目名称。",
    notFoundTitle: "找不到这个配置",
    notFoundBody: "配置可能已被删除，或链接中的 ID 不正确。",
    modelId: "Model ID",
    labelOverride: "显示名称",
    provider: "供应商",
    upstreamModel: "上游模型",
    supports1m: "支持 1M 上下文",
    prefer1m: "优先 1M 上下文",
    familyTier: "模型档位",
    familyDefault: "档位默认项",
    behavesAs: "兼容模型",
    maxEffort: "思考强度上限",
    countSuffix: "项",
    createTitle: "添加档案",
    createDescription: "创建供 Claude Desktop 使用的配置档案。",
    createAction: "添加",
    chooseProvider: "选择供应商",
    untitledModel: "未命名模型",
    removeModel: "删除模型",
    claudeFields: "Claude 透传",
    claudeEmpty: "没有自定义透传字段。",
    deleteProfile: "删除档案",
    namePlaceholder: "例如 deepseek-gateway",
    modeLabels: {
      standard: "标准直连",
      advanced: "网关路由",
      readOnly: "只读镜像",
    },
  },
  en: {
    title: "Profiles",
    subtitle: "Manage Claude Desktop configurations, model mappings, and gateway routes.",
    search: "Search profiles",
    closeSearch: "Close search",
    sort: "Sort",
    create: "Add profile",
    activeLabel: "Active profile",
    activated: "Active",
    notActivated: "Inactive",
    statusReadOnly: "Read only",
    listName: "Name",
    status: "Status",
    openProfile: "Open profile",
    type: "Type",
    mode: "Mode",
    applied: "Active",
    apply: "Apply",
    gateway: "Local gateway",
    gatewaySwitch: "Gateway switch",
    running: "Running",
    paused: "Paused",
    port: "Port",
    gatewayToken: "Gateway token",
    authScheme: "Auth scheme",
    back: "Back",
    addField: "Add field",
    basicInfo: "Details",
    models: "Models",
    addModel: "Add model",
    save: "Save changes",
    saveNote: "Prototype data · nothing is written to core",
    readOnlyNote: "Read-only profile · every field is disabled",
    note: "Demo data lives in demoProfiles; replace the data source when wiring core.",
    fieldTitle: "Add field",
    fieldHint: "Pick or type a Claude passthrough field; booleans use true/false, JSON is pasted directly.",
    fieldKey: "Key",
    fieldValue: "Value",
    fieldKeyPlaceholder: "e.g. modelCatalogUrl",
    fieldValuePlaceholder: "e.g. https://…",
    cancel: "Cancel",
    add: "Add",
    requiredKey: "Enter a key.",
    notFoundTitle: "Profile not found",
    notFoundBody: "It may have been removed, or the ID in the link is incorrect.",
    modelId: "Model ID",
    labelOverride: "Label override",
    provider: "Provider",
    upstreamModel: "Upstream model",
    supports1m: "Supports 1M context",
    prefer1m: "Prefer 1M context",
    familyTier: "Family tier",
    familyDefault: "Family default",
    behavesAs: "Behaves as",
    maxEffort: "Max effort",
    countSuffix: "items",
    createTitle: "Add profile",
    createDescription: "Create a configuration for Claude Desktop.",
    createAction: "Add",
    chooseProvider: "Choose a provider",
    untitledModel: "Untitled model",
    removeModel: "Remove model",
    claudeFields: "Claude passthrough",
    claudeEmpty: "No custom passthrough fields.",
    deleteProfile: "Delete profile",
    namePlaceholder: "e.g. deepseek-gateway",
    modeLabels: {
      standard: "Direct",
      advanced: "Gateway",
      readOnly: "Read-only mirror",
    },
  },
};

const TIERS: readonly { value: string; label: string }[] = [
  { value: "", label: "—" },
  { value: "haiku", label: "haiku" },
  { value: "sonnet", label: "sonnet" },
  { value: "opus", label: "opus" },
  { value: "fable", label: "fable" },
  { value: "mythos", label: "mythos" },
];

const EFFORTS: readonly { value: string; label: string }[] = [
  { value: "", label: "—" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
  { value: "max", label: "max" },
];

const SCHEMES: readonly { value: string; label: string }[] = [
  { value: "bearer", label: "Bearer" },
  { value: "x-api-key", label: "x-api-key" },
];

export function profileHref(id: string): string {
  return `#profiles/${encodeURIComponent(id)}`;
}

/** 解析 "#profiles/:id"；不是详情路由时返回 null。 */
export function parseProfileRoute(hash: string): string | null {
  const normalized = hash.replace(/^#/, "");
  const match = /^profiles\/([^/?#]+)$/.exec(normalized);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function render(context: PageContext, data: ProfilesDemo = demoProfiles): string {
  const copy = COPY[context.language];
  const active = data.profiles.find((profile) => profile.id === data.activeId) ?? null;

  return `<article class="page page--profiles profiles-page" data-role="page-profiles">
    <header class="profiles-band profiles-head-band">
      <div class="profiles-gutter profiles-head">
        <div class="profiles-heading">
          <h1>${escapeHtml(copy.title)}</h1>
          <p class="profiles-subtitle">${escapeHtml(copy.subtitle)}</p>
        </div>
        <div class="profiles-actions">
          <div class="profile-search" data-role="page-search" data-page-search data-open="false">
            <button type="button" class="profile-search-toggle" data-action="search-profiles" aria-label="${escapeHtml(copy.search)}" title="${escapeHtml(copy.search)}">${iconSvg("search", "profile-search-icon")}</button>
            <div class="profile-search-field">
              ${iconSvg("search", "profile-search-icon")}
              <input type="search" data-role="profile-search" placeholder="${escapeHtml(copy.search)}" aria-label="${escapeHtml(copy.search)}" autocomplete="off" spellcheck="false">
              <button type="button" class="profile-search-close" data-action="search-toggle" aria-label="${escapeHtml(copy.closeSearch)}">${iconSvg("close", "profile-search-close-icon")}</button>
            </div>
          </div>
          <button type="button" class="profile-button profile-button--primary" data-action="create-profile">${iconSvg("plus", "profile-button-icon")}<span>${escapeHtml(copy.create)}</span></button>
        </div>
      </div>
    </header>

    <section class="profiles-band profiles-active" data-role="active-profile"${active ? ` data-profile-id="${active.id}"` : ""}>
      <div class="profiles-gutter">
        ${active ? renderActiveHero(active, data.gatewayEnabled, copy) : `<p class="profiles-active-empty">${escapeHtml(copy.notActivated)}</p>`}
      </div>
    </section>

    <section class="profiles-band profiles-list" aria-label="${escapeHtml(copy.title)}">
      <div class="profile-list-head">
        <div class="profiles-gutter profile-grid">
          <span>${escapeHtml(copy.listName)}</span>
          <span>${escapeHtml(copy.type)}</span>
          <span>${escapeHtml(copy.status)}</span>
        </div>
      </div>
      <div class="profiles-rows profiles-gutter">
        ${data.profiles.map((profile) => renderRow(profile, copy)).join("")}
      </div>
    </section>

  </article>`;
}

export const PROFILE_CREATE_ID = "new";

/** 添加档案页的供应商选择项：直接读取当前演示供应商列表。 */
function renderProviderSelect(copy: Copy): string {
  const options = DEMO_PROVIDERS.map(
    (provider) =>
      `<option value="${escapeHtml(provider.name)}">${escapeHtml(provider.name)}</option>`,
  ).join("");
  return `<label class="profile-field-row">
    <span class="profiles-gutter profile-field-grid">
      <span class="profile-field-label">${escapeHtml(copy.provider)}</span>
      <select class="profile-input profile-select" data-field="provider">
        <option value="">${escapeHtml(copy.chooseProvider)}</option>
        ${options}
      </select>
    </span>
  </label>`;
}

function providerOptionsOf(providers?: readonly ProviderOption[]): readonly ProviderOption[] {
  return providers ?? DEMO_PROVIDERS.map((provider) => ({ id: provider.id, name: provider.name }));
}

function providerSelectRow(
  copy: Copy,
  providers: readonly ProviderOption[],
  value: string,
  disabled = false,
): string {
  const options = providers
    .map(
      (provider) =>
        `<option value="${escapeHtml(provider.id)}"${provider.id === value ? " selected" : ""}>${escapeHtml(provider.name)}</option>`,
    )
    .join("");
  return `<label class="profile-field-row">
    <span class="profiles-gutter profile-field-grid">
      <span class="profile-field-label">${escapeHtml(copy.provider)}</span>
      <select class="profile-input profile-select" data-field="provider"${disabled ? " disabled" : ""}>
        <option value="">${escapeHtml(copy.chooseProvider)}</option>
        ${options}
      </select>
    </span>
  </label>`;
}

function renderCreateProfile(context: PageContext, providers?: readonly ProviderOption[]): string {
  const copy = COPY[context.language];

  return `<article class="page page--profiles profiles-page profile-detail profile-add-page" data-role="page-profile-add" data-mode="standard">
    <header class="profiles-band profile-detail-top">
      <div class="profiles-gutter profile-detail-top-inner">
        <a class="profile-back" href="#profiles" data-action="profiles-back">${iconSvg("back", "profile-back-icon")}<span>${escapeHtml(copy.back)}</span></a>
      </div>
    </header>

    <div class="profiles-band profile-detail-heading">
      <div class="profiles-gutter">
        <h1>${escapeHtml(copy.createTitle)}</h1>
        <p class="profile-create-lede">${escapeHtml(copy.createDescription)}</p>
      </div>
    </div>

    <section class="profiles-band profile-section" aria-labelledby="profile-create-basic">
      <div class="profiles-gutter">
        <div class="profile-section-head">
          <h2 id="profile-create-basic">${escapeHtml(copy.basicInfo)}</h2>
        </div>
      </div>
      <div class="profile-form">
        <label class="profile-field-row">
          <span class="profiles-gutter profile-field-grid">
            <span class="profile-field-label">${escapeHtml(copy.listName)}</span>
            <input class="profile-input" type="text" data-field="name" placeholder="${escapeHtml(copy.namePlaceholder)}" autocomplete="off" spellcheck="false">
          </span>
        </label>
        <label class="profile-field-row">
          <span class="profiles-gutter profile-field-grid">
            <span class="profile-field-label">${escapeHtml(copy.mode)}</span>
            <select class="profile-input profile-select" data-role="profile-mode">
              <option value="standard" selected>${escapeHtml(copy.modeLabels.standard)}</option>
              <option value="advanced">${escapeHtml(copy.modeLabels.advanced)}</option>
            </select>
          </span>
        </label>
        <div class="profile-add-advanced">
          ${fieldRow(copy.port, "port", "", false, "number")}
          ${fieldRow(copy.gatewayToken, "gatewayToken", "", false)}
          ${selectRow(copy.authScheme, "gatewayAuthScheme", "bearer", SCHEMES, false)}
        </div>
      </div>
    </section>

    <section class="profiles-band profile-section profile-section--models" aria-labelledby="profile-create-models">
      <div class="profiles-gutter">
        <div class="profile-section-head">
          <h2 id="profile-create-models">${escapeHtml(copy.models)}</h2>
          <span class="profile-count" data-role="profile-add-model-count">0 ${escapeHtml(copy.countSuffix)}</span>
        </div>
      </div>
      <div class="profile-models">
        <div class="profile-add-model-list" data-role="profile-add-model-list"></div>
      </div>
      <div class="profiles-gutter">
        <button type="button" class="profile-button profile-button--dashed profile-add-model" data-action="add-profile-model">${iconSvg("plus", "profile-button-icon")}<span>${escapeHtml(copy.addModel)}</span></button>
      </div>
    </section>

    <div class="profile-savebar profiles-band" data-role="savebar">
      <div class="profiles-gutter profile-savebar-inner">
        <span class="profile-savebar-note">${escapeHtml(copy.saveNote)}</span>
        <button type="button" class="profile-button profile-button--primary profile-save" data-action="create-profile-submit">${escapeHtml(copy.createAction)}</button>
      </div>
    </div>
  </article>`;
}

/** 点击“添加模型”时插入的空白模型条目（与详情页模型卡片同构）。 */
export function renderAddModelEntry(index: number, language: Language, providers?: readonly ProviderOption[]): string {
  const copy = COPY[language];
  const options = providerOptionsOf(providers)
    .map(
      (provider) =>
        `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.name)}</option>`,
    )
    .join("");

  return `<details class="profile-model profile-add-model-entry" data-role="profile-add-model-entry" data-model-index="${index}" data-untitled="${escapeHtml(copy.untitledModel)}" open>
    <summary class="profile-model-summary">
      <span class="profiles-gutter profile-model-summary-inner">
        <span class="profile-model-name" data-role="model-summary-name">${escapeHtml(copy.untitledModel)}</span>
        <span class="profile-model-tier" data-role="model-summary-tier" hidden></span>
        <span class="profile-model-badge" data-role="model-summary-1m" hidden>1M</span>
        <span class="profile-model-provider" data-role="model-summary-provider"></span>
        <button type="button" class="profile-model-remove" data-action="remove-add-model" aria-label="${escapeHtml(copy.removeModel)}">
          ${iconSvg("trash", "profile-model-remove-icon")}
        </button>
      </span>
    </summary>
    <div class="profile-model-body">
      ${fieldRow(copy.modelId, "modelName", "", false)}
      ${fieldRow(copy.labelOverride, "labelOverride", "", false)}
      <label class="profile-field-row">
        <span class="profiles-gutter profile-field-grid">
          <span class="profile-field-label">${escapeHtml(copy.provider)}</span>
          <select class="profile-input profile-select" data-field="provider">
            <option value="">${escapeHtml(copy.chooseProvider)}</option>
            ${options}
          </select>
        </span>
      </label>
      ${switchRow(copy.supports1m, "supports1m", false, false)}
      ${selectRow(copy.familyTier, "anthropicFamilyTier", "", TIERS, false)}
      ${switchRow(copy.familyDefault, "isFamilyDefault", false, false)}
      ${fieldRow(copy.behavesAs, "behavesAs", "", false)}
      ${selectRow(copy.maxEffort, "maxEffort", "", EFFORTS, false)}
      <div class="profile-add-advanced">
        ${fieldRow(copy.upstreamModel, "upstreamModel", "", false)}
      </div>
    </div>
  </details>`;
}

export function renderDetail(
  context: PageContext,
  id: string,
  data: ProfilesDemo = demoProfiles,
  providers?: readonly ProviderOption[],
): string {
  const copy = COPY[context.language];
  const providerOptions = providerOptionsOf(providers ?? data.providers);
  if (id === PROFILE_CREATE_ID) return renderCreateProfile(context, providerOptions);
  const profile = data.profiles.find((item) => item.id === id);
  if (!profile) return renderNotFound(copy, id);

  const readOnly = profile.mode === "readOnly";
  const models = profile.models ?? [];

  return `<article class="page page--profiles profiles-page profile-detail" data-role="page-profile-detail" data-profile-id="${profile.id}" data-mode="${profile.mode}">
    <header class="profiles-band profile-detail-top">
      <div class="profiles-gutter profile-detail-top-inner">
        <a class="profile-back" href="#profiles" data-action="profiles-back">${iconSvg("back", "profile-back-icon")}<span>${escapeHtml(copy.back)}</span></a>
        <button type="button" class="profile-button profile-button--ghost" data-action="add-field" data-profile-id="${profile.id}"${readOnly ? " disabled" : ""}>${iconSvg("plus", "profile-button-icon")}<span>${escapeHtml(copy.addField)}</span></button>
      </div>
    </header>

    <div class="profiles-band profile-detail-heading">
      <div class="profiles-gutter">
        <h1>${escapeHtml(profile.name)}</h1>
        <div class="profile-detail-badges">
          ${typeTag(profile)}
          ${statusPill(profile, copy)}
        </div>
      </div>
    </div>

    <section class="profiles-band profile-section" aria-labelledby="profile-basic-title">
      <div class="profiles-gutter">
        <div class="profile-section-head">
          <h2 id="profile-basic-title">${escapeHtml(copy.basicInfo)}</h2>
        </div>
      </div>
      <div class="profile-form">
        ${staticRow(copy.mode, "mode", modeLabel(copy, profile.mode))}
        ${profile.mode === "advanced" ? renderGatewayFields(profile, readOnly, copy) : ""}
      </div>
    </section>

    ${
      readOnly
        ? ""
        : `<section class="profiles-band profile-section" data-role="claude-section" aria-labelledby="profile-claude-title">
      <div class="profiles-gutter">
        <div class="profile-section-head">
          <h2 id="profile-claude-title">${escapeHtml(copy.claudeFields)}</h2>
          <span class="profile-count">${Object.keys(profile.claude ?? {}).length} ${escapeHtml(copy.countSuffix)}</span>
        </div>
      </div>
      <div class="profiles-gutter profile-claude-list">
        ${
          Object.keys(profile.claude ?? {}).length === 0
            ? `<p class="profile-claude-empty">${escapeHtml(copy.claudeEmpty)}</p>`
            : Object.entries(profile.claude ?? {})
                .map(
                  ([key, value]) => `<div class="profile-claude-row" data-claude-key="${escapeHtml(key)}">
                    <span class="profile-claude-key">${escapeHtml(key)}</span>
                    <span class="profile-claude-value">${escapeHtml(typeof value === "string" ? value : JSON.stringify(value))}</span>
                    <button type="button" class="profile-model-remove" data-action="remove-claude-field" data-claude-key="${escapeHtml(key)}" aria-label="${escapeHtml(copy.removeModel)}">${iconSvg("trash", "profile-model-remove-icon")}</button>
                  </div>`,
                )
                .join("")
        }
      </div>
    </section>`
    }

    <section class="profiles-band profile-section profile-section--models" aria-labelledby="profile-models-title">
      <div class="profiles-gutter">
        <div class="profile-section-head">
          <h2 id="profile-models-title">${escapeHtml(copy.models)}</h2>
          <span class="profile-count">${models.length} ${escapeHtml(copy.countSuffix)}</span>
        </div>
      </div>
      <div class="profile-models">
        ${
          models.length > 0
            ? models.map((model, index) => renderModel(model, index, profile, readOnly, copy, providerOptions)).join("")
            : `<div class="profiles-gutter"><p class="profile-models-empty">${escapeHtml(copy.notActivated)}</p></div>`
        }
      </div>
      <div class="profiles-gutter">
        <button type="button" class="profile-button profile-button--dashed profile-add-model" data-action="add-model"${readOnly ? " disabled" : ""}>${iconSvg("plus", "profile-button-icon")}<span>${escapeHtml(copy.addModel)}</span></button>
      </div>
    </section>

    <div class="profile-savebar profiles-band" data-role="savebar">
      <div class="profiles-gutter profile-savebar-inner">
        ${
          readOnly
            ? `<span class="profile-savebar-note">${escapeHtml(copy.readOnlyNote)}</span>`
            : `<button type="button" class="profile-button profile-button--danger-solid" data-action="delete-profile" data-profile-id="${profile.id}">${iconSvg("trash", "profile-button-icon")}<span>${escapeHtml(copy.deleteProfile)}</span></button>`
        }
        <button type="button" class="profile-button profile-button--primary profile-save" data-action="save-profile"${readOnly ? " disabled" : ""}>${escapeHtml(copy.save)}</button>
      </div>
    </div>
  </article>`;
}

export interface FieldModalOptions {
  readonly onAdd?: (field: { readonly key: string; readonly value: string }) => void;
  readonly onClose?: () => void;
  readonly language?: Language;
}

const CLAUDE_FIELD_KEYS = [
  "inferenceStreamIdleTimeoutSec",
  "inferenceCustomHeaders",
  "userContentRendererUrl",
  "inferenceGatewayManagedClaudeCode",
  "inferenceGatewayAutoModeServerChecks",
  "modelPrefer1mContext",
  "defaultModelEffort",
  "alwaysStartWithDefaultModel",
  "inferenceModelPricingEnabled",
  "inferenceModelPricingMultiplier",
  "inferenceModelPricing",
  "modelCatalogUrl",
  "egressProxyUrl",
  "egressProxyPacUrl",
  "coworkVmIpv6Enabled",
  "disableDeploymentModeChooser",
  "deploymentDisplayName",
  "desktopHome",
  "sshTransport",
  "toolSearchEnabled",
  "skipWebFetchPreflight",
  "builtinBrowserEnabled",
  "isDesktopExtensionEnabled",
  "coworkEgressAllowedHosts",
  "claudeAiImport",
] as const;

let fieldModalSeq = 0;

/** 居中的“项目 / 值”小弹窗；调用方负责挂到 body。Esc 与遮罩点击均可关闭。 */
export function createFieldModal(options: FieldModalOptions = {}): HTMLElement {
  const copy = COPY[options.language ?? "zh"];
  const doc = document;
  const seq = ++fieldModalSeq;
  const titleId = `profile-field-title-${seq}`;
  let closed = false;

  const create = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
  ): HTMLElementTagNameMap[K] => {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    return element;
  };

  const overlay = create("div", "profile-field-overlay");
  overlay.setAttribute("data-role", "field-overlay");

  const dialog = create("div", "profile-field-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", titleId);
  dialog.setAttribute("data-role", "field-dialog");
  overlay.appendChild(dialog);

  const title = create("h2", "profile-field-title");
  title.id = titleId;
  title.textContent = copy.fieldTitle;
  dialog.appendChild(title);

  const hint = create("p", "profile-field-hint");
  hint.textContent = copy.fieldHint;
  dialog.appendChild(hint);

  const grid = create("div", "profile-field-grid");
  grid.setAttribute("data-role", "field-grid");
  dialog.appendChild(grid);

  const keyControl = create("label", "profile-field-control");
  const keyCaption = create("span", "profile-field-caption");
  keyCaption.textContent = copy.fieldKey;
  const keyInput = create("input", "profile-field-input");
  keyInput.type = "text";
  keyInput.setAttribute("data-role", "field-key");
  keyInput.setAttribute("placeholder", copy.fieldKeyPlaceholder);
  keyInput.setAttribute("autocomplete", "off");
  keyInput.setAttribute("list", "profile-claude-fields");
  const keyList = create("datalist");
  keyList.id = "profile-claude-fields";
  for (const key of CLAUDE_FIELD_KEYS) {
    const option = create("option");
    option.value = key;
    keyList.appendChild(option);
  }
  dialog.appendChild(keyList);
  keyControl.append(keyCaption, keyInput);
  grid.appendChild(keyControl);

  const valueControl = create("label", "profile-field-control");
  const valueCaption = create("span", "profile-field-caption");
  valueCaption.textContent = copy.fieldValue;
  const valueInput = create("input", "profile-field-input");
  valueInput.type = "text";
  valueInput.setAttribute("data-role", "field-value");
  valueInput.setAttribute("placeholder", copy.fieldValuePlaceholder);
  valueInput.setAttribute("autocomplete", "off");
  valueControl.append(valueCaption, valueInput);
  grid.appendChild(valueControl);

  const error = create("p", "profile-field-error");
  error.setAttribute("data-role", "field-error");
  error.textContent = copy.requiredKey;
  error.hidden = true;
  dialog.appendChild(error);

  const actions = create("div", "profile-field-actions");
  const cancel = create("button", "profile-button profile-button--ghost");
  cancel.type = "button";
  cancel.setAttribute("data-action", "cancel-field");
  cancel.textContent = copy.cancel;
  const confirm = create("button", "profile-button profile-button--primary");
  confirm.type = "button";
  confirm.setAttribute("data-action", "confirm-field");
  confirm.textContent = copy.add;
  actions.append(cancel, confirm);
  dialog.appendChild(actions);

  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    options.onClose?.();
  };

  const submit = (): void => {
    const key = keyInput.value.trim();
    if (!key) {
      error.hidden = false;
      keyInput.focus();
      return;
    }
    options.onAdd?.({ key, value: valueInput.value.trim() });
    close();
  };

  cancel.addEventListener("click", close);
  confirm.addEventListener("click", submit);
  for (const input of [keyInput, valueInput]) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });
  }
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  setTimeout(() => {
    if (!closed) keyInput.focus();
  }, 0);

  return overlay;
}

/* ------------------------------------------------------------------ */
/* 片段                                                                */
/* ------------------------------------------------------------------ */

function typeTag(profile: ProfileDraft): string {
  return `<span class="profile-type-tag profile-type-tag--${profile.mode}" data-type="${profile.mode}">${profile.mode}</span>`;
}

function modeLabel(copy: Copy, mode: ProfileMode): string {
  return copy.modeLabels[mode];
}

function statusLabel(profile: ProfileDraft, copy: Copy): string {
  if (profile.mode === "readOnly") return copy.statusReadOnly;
  return profile.applied ? copy.activated : copy.notActivated;
}

function statusPill(profile: ProfileDraft, copy: Copy): string {
  const state = profile.mode === "readOnly" ? "readonly" : profile.applied ? "active" : "idle";
  const label = statusLabel(profile, copy);
  const visible = state === "active" ? "✓" : state === "idle" ? "—" : label;
  return `<span class="profile-status profile-status--${state}" data-status="${state}" aria-label="${escapeHtml(label)}">${escapeHtml(visible)}</span>`;
}

/**
 * 列表页“当前激活配置”卡片：名称 + 模式标签，高级配置附网关信息条，
 * 下方按行列出模型摘要（档位 / 1M / 供应商 → 上游模型 + 进入箭头）。
 */
function renderActiveHero(profile: ProfileDraft, gatewayEnabled: boolean, copy: Copy): string {
  const models = profile.models ?? [];
  const gatewayBar =
    profile.mode === "advanced"
      ? `<div class="profiles-hero-gateway">${renderGatewayBar(profile, gatewayEnabled, copy)}</div>`
      : "";

  const rows = models
    .map((model) => {
      const tier = model.anthropicFamilyTier
        ? `<span class="profile-model-tier">${escapeHtml(model.anthropicFamilyTier)}</span>`
        : "";
      const oneM = model.supports1m ? `<span class="profile-model-badge">1M</span>` : "";
      const route =
        profile.mode === "advanced" && model.upstreamModel
          ? `${model.providerName ?? ""} → ${model.upstreamModel}`
          : (model.providerName ?? "");
      return `<li class="profiles-hero-model">
        <span class="profiles-hero-model-lead">
          <span class="profiles-hero-model-name">${escapeHtml(model.name)}</span>${tier}${oneM}
        </span>
        <span class="profiles-hero-model-route">${escapeHtml(route)}</span>
      </li>`;
    })
    .join("");

  return `<div class="profiles-hero">
    <div class="profiles-hero-head">
      <a class="profiles-hero-name" href="${profileHref(profile.id)}" data-action="open-profile" data-profile-id="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</a>
      <span class="profiles-hero-tag">${escapeHtml(modeLabel(copy, profile.mode))}</span>
    </div>
    ${gatewayBar}
    ${models.length > 0 ? `<ul class="profiles-hero-models">${rows}</ul>` : ""}
  </div>`;
}

function renderGatewayBar(profile: ProfileDraft, enabled: boolean, copy: Copy): string {
  const scheme = profile.gatewayAuthScheme ?? "bearer";
  return `<div class="profile-gateway" data-role="gateway-bar" data-profile-id="${escapeHtml(profile.id)}" data-gateway-enabled="${enabled ? "true" : "false"}">
    <span class="profile-gateway-label">${escapeHtml(copy.gateway)}</span>
    <span class="profile-gateway-status">${escapeHtml(enabled ? copy.running : copy.paused)}</span>
    <span class="profile-gateway-meta">${escapeHtml(copy.port)} ${profile.port ?? "—"} · ${escapeHtml(scheme)}</span>
    <label class="profile-switch">
      <input class="profile-switch-input" type="checkbox" data-role="gateway-switch" aria-label="${escapeHtml(copy.gatewaySwitch)}"${enabled ? " checked" : ""}>
      <span class="profile-switch-track" aria-hidden="true"></span>
    </label>
  </div>`;
}

function renderRow(profile: ProfileDraft, copy: Copy): string {
  const status = profile.applied
    ? statusPill(profile, copy)
    : profile.mode === "readOnly"
      ? `<span class="profile-status profile-status--readonly" data-status="readonly" aria-label="${escapeHtml(copy.statusReadOnly)}"></span>`
      : `<button type="button" class="profile-apply" data-action="apply-profile" data-profile-id="${profile.id}" aria-label="${escapeHtml(`${copy.apply}: ${profile.name}`)}">${escapeHtml(copy.apply)}</button>`;
  return `<div class="profile-row profile-grid" data-profile-id="${profile.id}" data-applied="${profile.applied ? "true" : "false"}">
    <a class="profile-row-open" href="${profileHref(profile.id)}" data-action="open-profile" data-profile-id="${profile.id}" aria-label="${escapeHtml(`${copy.openProfile}: ${profile.name}`)}">
      <span class="profile-row-name">${escapeHtml(profile.name)}</span>
      <span class="profile-row-type">${typeTag(profile)}</span>
    </a>
    <span class="profile-row-status">${status}</span>
  </div>`;
}

function fieldRow(
  label: string,
  field: string,
  value: unknown,
  disabled: boolean,
  type = "text",
): string {
  return `<label class="profile-field-row">
    <span class="profiles-gutter profile-field-grid">
      <span class="profile-field-label">${escapeHtml(label)}</span>
      <input class="profile-input" type="${type}" data-field="${field}" value="${escapeHtml(value)}"${disabled ? " disabled" : ""}>
    </span>
  </label>`;
}

function staticRow(label: string, field: string, value: string): string {
  return `<div class="profile-field-row profile-field-row--static">
    <span class="profiles-gutter profile-field-grid">
      <span class="profile-field-label">${escapeHtml(label)}</span>
      <span class="profile-field-static" data-field="${field}">${escapeHtml(value)}</span>
    </span>
  </div>`;
}

function selectRow(
  label: string,
  field: string,
  value: string,
  options: readonly { readonly value: string; readonly label: string }[],
  disabled: boolean,
): string {
  const rendered = options
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}"${option.value === value ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
    )
    .join("");
  return `<label class="profile-field-row">
    <span class="profiles-gutter profile-field-grid">
      <span class="profile-field-label">${escapeHtml(label)}</span>
      <select class="profile-input profile-select" data-field="${field}"${disabled ? " disabled" : ""}>${rendered}</select>
    </span>
  </label>`;
}

function switchRow(label: string, field: string, checked: boolean, disabled: boolean): string {
  return `<label class="profile-field-row profile-field-row--switch">
    <span class="profiles-gutter profile-field-grid">
      <span class="profile-field-label">${escapeHtml(label)}</span>
      <span class="profile-switch">
        <input class="profile-switch-input" type="checkbox" data-field="${field}"${checked ? " checked" : ""}${disabled ? " disabled" : ""}>
        <span class="profile-switch-track" aria-hidden="true"></span>
      </span>
    </span>
  </label>`;
}

function renderGatewayFields(profile: ProfileDraft, readOnly: boolean, copy: Copy): string {
  return `${fieldRow(copy.port, "port", profile.port ?? "", readOnly, "number")}
    ${fieldRow(copy.gatewayToken, "gatewayToken", profile.gatewayToken ?? "", readOnly)}
    ${selectRow(copy.authScheme, "gatewayAuthScheme", profile.gatewayAuthScheme ?? "bearer", SCHEMES, readOnly)}`;
}

function renderModel(
  model: ProfileModelDraft,
  index: number,
  profile: ProfileDraft,
  disabled: boolean,
  copy: Copy,
  providers: readonly ProviderOption[],
): string {
  const provider =
    profile.mode === "readOnly"
      ? ""
      : `<span class="profile-model-provider">${escapeHtml(model.providerName ?? "—")}${profile.mode === "advanced" && model.upstreamModel ? ` → ${escapeHtml(model.upstreamModel)}` : ""}</span>`;

  return `<details class="profile-model" data-role="model-item" data-model-index="${index}" data-original-name="${escapeHtml(model.name)}"${index === 0 ? " open" : ""}>
    <summary class="profile-model-summary">
      <span class="profiles-gutter profile-model-summary-inner">
        <span class="profile-model-name">${escapeHtml(model.name)}</span>
        ${model.anthropicFamilyTier ? `<span class="profile-model-tier">${escapeHtml(model.anthropicFamilyTier)}</span>` : ""}
        ${model.supports1m ? `<span class="profile-model-badge">1M</span>` : ""}
        ${provider}
        ${disabled ? "" : `<button type="button" class="profile-model-remove" data-action="remove-profile-model" aria-label="${escapeHtml(copy.removeModel)}">
          ${iconSvg("trash", "profile-model-remove-icon")}
        </button>`}
      </span>
    </summary>
    <div class="profile-model-body">
      ${fieldRow(copy.modelId, "modelName", model.name, disabled)}
      ${fieldRow(copy.labelOverride, "labelOverride", model.labelOverride ?? "", disabled)}
      ${profile.mode !== "readOnly" ? providerSelectRow(copy, providers, model.provider ?? "", disabled) : ""}
      ${profile.mode === "advanced" ? fieldRow(copy.upstreamModel, "upstreamModel", model.upstreamModel ?? "", disabled) : ""}
      ${switchRow(copy.supports1m, "supports1m", model.supports1m === true, disabled)}
      ${selectRow(copy.familyTier, "anthropicFamilyTier", model.anthropicFamilyTier ?? "", TIERS, disabled)}
      ${switchRow(copy.familyDefault, "isFamilyDefault", model.isFamilyDefault === true, disabled)}
      ${fieldRow(copy.behavesAs, "behavesAs", model.behavesAs ?? "", disabled)}
      ${selectRow(copy.maxEffort, "maxEffort", model.maxEffort ?? "", EFFORTS, disabled)}
    </div>
  </details>`;
}

function renderNotFound(copy: Copy, id: string): string {
  return `<article class="page page--profiles profiles-page profile-detail" data-role="page-profile-detail" data-profile-id="${escapeHtml(id)}">
    <header class="profiles-band profile-detail-top">
      <div class="profiles-gutter profile-detail-top-inner">
        <a class="profile-back" href="#profiles" data-action="profiles-back">${iconSvg("back", "profile-back-icon")}<span>${escapeHtml(copy.back)}</span></a>
      </div>
    </header>
    <section class="profiles-band profile-not-found" data-role="profile-not-found">
      <div class="profiles-gutter">
        <h1>${escapeHtml(copy.notFoundTitle)}</h1>
        <p>${escapeHtml(copy.notFoundBody)}</p>
        <a class="profile-button profile-button--primary" href="#profiles">${escapeHtml(copy.back)}</a>
      </div>
    </section>
  </article>`;
}
