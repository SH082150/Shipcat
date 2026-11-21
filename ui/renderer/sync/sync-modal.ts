/**
 * 需要同步弹窗：设置页同款悬浮窗。
 *
 * 输入是 core 的 buildSyncPlan（只读），输出是 SyncDecisions。
 * 三类内容分别渲染：基本信息表格、模型卡片、透传表格；
 * 每行四列：项名 / Shipcat 当前值 / Claude 当前值 / 最终值。
 */

import type { SyncDecisions, SyncField, SyncModel, SyncPlan } from "../../../core/sync/index.ts";
import type { Language } from "../components/i18n.ts";
import { escapeHtml } from "../components/html.ts";
import { iconSvg } from "../components/icons.ts";
import { trapFocus } from "../components/focus-trap.ts";
import type { ProviderOption } from "../pages/profiles.ts";

export interface SyncDrafts {
  /** 已存在的字段草稿：path → 文本。 */
  readonly values?: Readonly<Record<string, string>>;
  /** 尚未保存的新增透传项。 */
  readonly passthrough?: readonly { readonly key: string; readonly value: string }[];
}

export interface SyncModalOptions {
  readonly plan: SyncPlan;
  readonly language: Language;
  readonly providers: readonly ProviderOption[];
  readonly drafts?: SyncDrafts;
  readonly onApply: (decisions: SyncDecisions) => Promise<void>;
  readonly onClose: () => void;
}

const ZH = {
  title: "需要同步",
  subtitle: "Shipcat 与 Claude 侧的配置不一致，处理完才能继续编辑。",
  basic: "基本信息",
  models: "模型",
  passthrough: "Claude 透传",
  item: "项名",
  local: "Shipcat 当前值",
  claude: "Claude 当前值",
  final: "最终值",
  back: "返回列表",
  apply: "保存同步",
  delete: "删除",
  deleteItem: "删除此项",
  provider: "供应商",
  upstream: "上游模型",
  chooseProvider: "选择供应商",
  sealed: "（已加密）",
  secret: "••••••",
  absent: "—",
  fileMissing: "Claude 侧 profile 文件缺失，保存同步会按 Shipcat 重建。",
  requiredProvider: "新增模型必须选择供应商。",
  requiredUpstream: "advanced 新增模型必须填写上游模型。",
  applying: "正在保存…",
} as const;

type SyncCopy = Record<keyof typeof ZH, string>;

const EN: SyncCopy = {
  title: "Sync needed",
  subtitle: "Shipcat and Claude differ. Resolve them before editing.",
  basic: "Details",
  models: "Models",
  passthrough: "Claude passthrough",
  item: "Item",
  local: "Shipcat value",
  claude: "Claude value",
  final: "Final value",
  back: "Back to profiles",
  apply: "Save sync",
  delete: "Delete",
  deleteItem: "Delete this item",
  provider: "Provider",
  upstream: "Upstream model",
  chooseProvider: "Choose a provider",
  sealed: "(sealed)",
  secret: "••••••",
  absent: "—",
  fileMissing: "Claude profile file is missing; saving will rebuild it from Shipcat.",
  requiredProvider: "A provider is required for an added model.",
  requiredUpstream: "An upstream model is required for an added advanced model.",
  applying: "Saving…",
};

const GROUP_LABELS: Record<string, string> = {
  gateway: "网关",
  profile: "档案名称",
  passthrough: "透传项",
};

const FIELD_LABELS: Record<string, string> = {
  name: "名称",
  port: "端口",
  authScheme: "鉴权方案",
  gatewayToken: "网关 Token",
  baseUrl: "URL",
  apiKey: "密钥",
  inferenceProvider: "提供方",
  inferenceCredentialKind: "凭证类型",
  labelOverride: "显示名称",
  supports1m: "支持 1M 上下文",
  prefer1m: "优先 1M 上下文",
  anthropicFamilyTier: "模型档位",
  isFamilyDefault: "档位默认项",
  behavesAs: "兼容模型",
  maxEffort: "思考强度上限",
};

const SELECT_OPTIONS: Record<string, readonly (readonly [string, string])[]> = {
  authScheme: [
    ["bearer", "bearer"],
    ["x-api-key", "x-api-key"],
  ],
  anthropicFamilyTier: [
    ["haiku", "haiku"],
    ["sonnet", "sonnet"],
    ["opus", "opus"],
    ["fable", "fable"],
    ["mythos", "mythos"],
  ],
  maxEffort: [
    ["low", "low"],
    ["medium", "medium"],
    ["high", "high"],
    ["xhigh", "xhigh"],
    ["max", "max"],
  ],
};

let seq = 0;

export function createSyncModal(options: SyncModalOptions): HTMLElement {
  const copy: SyncCopy = options.language === "zh" ? ZH : EN;
  const { plan, drafts } = options;
  const id = `ch-sync-title-${++seq}`;
  const doc = document;

  const overlay = doc.createElement("div");
  overlay.className = "ch-settings-overlay ch-sync-overlay";
  overlay.dataset.theme = doc.documentElement.dataset.theme ?? "light";
  overlay.setAttribute("data-role", "sync-overlay");

  const dialog = doc.createElement("div");
  dialog.className = "ch-settings ch-sync";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", id);
  overlay.appendChild(dialog);

  const finalValueOf = (field: SyncField): string => {
    const draft = drafts?.values?.[field.path];
    const localText = field.kind === "secret" ? (field.local.raw ?? "") : field.local.text;
    // 只有"确实改过"的草稿才覆盖当前值：与已保存值相同（或空）的输入不算草稿。
    if (draft !== undefined && draft !== "" && (!field.local.present || draft !== localText)) {
      return draft;
    }
    if (field.kind === "secret") return field.local.raw ?? field.claude.raw ?? "";
    if (field.local.present) return field.local.text;
    if (field.importable && field.claude.present) return field.claude.text;
    return "";
  };

  const displayOf = (value: SyncField["local"]): string => {
    if (value.sealed) return copy.sealed;
    if (value.secret) return copy.secret;
    if (!value.present) return copy.absent;
    return escapeHtml(value.text);
  };

  const controlOf = (field: SyncField, key: string): string => {
    const value = finalValueOf(field);
    const disabled = !field.importable && field.kind !== "secret" ? " disabled" : "";
    if (field.kind === "boolean") {
      return `<select class="sync-input" data-final="${escapeHtml(key)}">
        <option value="true"${value === "true" ? " selected" : ""}>true</option>
        <option value="false"${value === "false" ? " selected" : ""}>false</option>
      </select>`;
    }
    const choices = SELECT_OPTIONS[field.field];
    if (field.kind === "select" && choices !== undefined) {
      return `<select class="sync-input" data-final="${escapeHtml(key)}"${disabled}>
        ${choices
          .map(
            ([option, label]) =>
              `<option value="${escapeHtml(option)}"${value === option ? " selected" : ""}>${escapeHtml(label)}</option>`,
          )
          .join("")}
      </select>`;
    }
    const type = field.kind === "secret" ? "password" : field.kind === "number" ? "number" : "text";
    return `<input class="sync-input" type="${type}" data-final="${escapeHtml(key)}" value="${escapeHtml(value)}"${disabled}>`;
  };

  const itemName = (field: SyncField): string => {
    const category =
      field.category === "basic"
        ? copy.basic
        : field.category === "model"
          ? copy.models
          : copy.passthrough;
    const group =
      field.category === "model"
        ? field.group
        : (GROUP_LABELS[field.group] ?? field.group);
    const item =
      field.category === "model" && field.field === "name"
        ? "Model ID"
        : field.category === "passthrough"
          ? field.field
          : (FIELD_LABELS[field.field] ?? field.field);
    return `${escapeHtml(category)} › ${escapeHtml(group)} › ${escapeHtml(item)}`;
  };

  const rowOf = (field: SyncField, category: "basic" | "passthrough"): string => {
    const key = field.category === "passthrough" ? field.field : field.path;
    const deleteControl =
      category === "passthrough"
        ? `<label class="sync-delete"><input type="checkbox" data-delete>${copy.deleteItem}</label>`
        : "";
    return `<tr data-path="${escapeHtml(field.path)}" data-key="${escapeHtml(key)}" data-kind="${field.kind}" data-importable="${field.importable}">
      <td class="sync-item">${itemName(field)}</td>
      <td class="sync-value">${displayOf(field.local)}</td>
      <td class="sync-value">${displayOf(field.claude)}</td>
      <td class="sync-final">${controlOf(field, key)}${deleteControl}</td>
    </tr>`;
  };

  const tableOf = (
    fields: readonly SyncField[],
    category: "basic" | "passthrough",
  ): string => `<table class="sync-table">
    <thead><tr><th>${copy.item}</th><th>${copy.local}</th><th>${copy.claude}</th><th>${copy.final}</th></tr></thead>
    <tbody>${fields.map((field) => rowOf(field, category)).join("")}</tbody>
  </table>`;

  const modelCard = (model: SyncModel): string => {
    const providerOptions = options.providers
      .map(
        (provider) =>
          `<option value="${escapeHtml(provider.id)}"${provider.id === model.provider ? " selected" : ""}>${escapeHtml(provider.name)}</option>`,
      )
      .join("");
    const providerValue = model.provider ?? options.providers[0]?.id ?? "";
    const fields = model.fields
      .map((field) => {
        const key = `${model.index}.${field.field}`;
        return `<tr data-path="${escapeHtml(field.path)}" data-model-field="${escapeHtml(field.field)}" data-kind="${field.kind}">
          <td class="sync-item">${itemName(field)}</td>
          <td class="sync-value">${displayOf(field.local)}</td>
          <td class="sync-value">${displayOf(field.claude)}</td>
          <td class="sync-final">${controlOf(field, key)}</td>
        </tr>`;
      })
      .join("");
    const extraRows = model.needsProvider
      ? `<tr data-required="provider">
          <td class="sync-item">${escapeHtml(copy.models)} › ${escapeHtml(model.name)} › ${escapeHtml(copy.provider)}</td>
          <td class="sync-value">${copy.absent}</td>
          <td class="sync-value">${copy.absent}</td>
          <td class="sync-final"><select class="sync-input" data-model-provider>
            <option value="">${escapeHtml(copy.chooseProvider)}</option>${providerOptions}
          </select></td>
        </tr>`
      : "";
    const upstreamRow = model.needsUpstream
      ? `<tr data-required="upstream">
          <td class="sync-item">${escapeHtml(copy.models)} › ${escapeHtml(model.name)} › ${escapeHtml(copy.upstream)}</td>
          <td class="sync-value">${copy.absent}</td>
          <td class="sync-value">${copy.absent}</td>
          <td class="sync-final"><input class="sync-input" type="text" data-model-upstream value="${escapeHtml(model.upstreamModel ?? "")}"></td>
        </tr>`
      : "";
    const rows = fields + extraRows + upstreamRow;
    return `<div class="sync-model" data-model-index="${model.index}" data-status="${model.status}">
      <div class="sync-model-head">
        <span>${escapeHtml(model.name)}</span>
        <button type="button" class="sync-model-delete" data-model-delete>${iconSvg("trash", "sync-trash")}${copy.delete}</button>
      </div>
      ${rows === "" ? "" : `<table class="sync-table"><tbody>${rows}</tbody></table>`}
    </div>`;
  };

  const passthroughDrafts = (drafts?.passthrough ?? []).map(
    (draft) => `<tr data-path="draft:${escapeHtml(draft.key)}" data-key="${escapeHtml(draft.key)}" data-kind="text" data-draft="true">
      <td class="sync-item">${escapeHtml(copy.passthrough)} › ${escapeHtml(GROUP_LABELS.passthrough)} › ${escapeHtml(draft.key)}</td>
      <td class="sync-value">${copy.absent}</td>
      <td class="sync-value">${copy.absent}</td>
      <td class="sync-final"><input class="sync-input" type="text" data-final="${escapeHtml(draft.key)}" value="${escapeHtml(draft.value)}"><label class="sync-delete"><input type="checkbox" data-delete>${copy.deleteItem}</label></td>
    </tr>`,
  );

  dialog.innerHTML = `<header class="sync-head">
    <div class="sync-head-copy">
      <h2 id="${id}">${copy.title}</h2>
      <p class="sync-subtitle">${copy.subtitle}</p>
    </div>
    <button type="button" class="sync-close" data-sync-close aria-label="Close">${iconSvg("close", "sync-close-icon")}</button>
  </header>
  <div class="sync-body">
    ${plan.fileMissing ? `<p class="sync-warning">${copy.fileMissing}</p>` : ""}
    ${
      plan.basic.length > 0
        ? `<section class="sync-section"><div class="sync-section-head"><h3>${copy.basic}</h3><span class="sync-count">${plan.basic.length}</span></div><div class="sync-table-wrap">${tableOf(plan.basic, "basic")}</div></section>`
        : ""
    }
    ${
      plan.models.length > 0
        ? `<section class="sync-section"><div class="sync-section-head"><h3>${copy.models}</h3><span class="sync-count">${plan.models.length}</span></div><div class="sync-models">${plan.models.map(modelCard).join("")}</div></section>`
        : ""
    }
    ${
      plan.passthrough.length > 0 || passthroughDrafts.length > 0
        ? `<section class="sync-section"><div class="sync-section-head"><h3>${copy.passthrough}</h3><span class="sync-count">${plan.passthrough.length + passthroughDrafts.length}</span></div><div class="sync-table-wrap"><table class="sync-table">
            <thead><tr><th>${copy.item}</th><th>${copy.local}</th><th>${copy.claude}</th><th>${copy.final}</th></tr></thead>
            <tbody>${plan.passthrough.map((field) => rowOf(field, "passthrough")).join("")}${passthroughDrafts.join("")}</tbody>
          </table></div></section>`
        : ""
    }
    <p class="sync-error" data-sync-error hidden></p>
  </div>
  <footer class="sync-foot">
    <button type="button" class="sync-button sync-button--ghost" data-sync-back>${copy.back}</button>
    <button type="button" class="sync-button sync-button--primary" data-sync-apply>${copy.apply}</button>
  </footer>`;

  const error = dialog.querySelector<HTMLElement>("[data-sync-error]")!;
  const applyButton = dialog.querySelector<HTMLButtonElement>("[data-sync-apply]")!;
  let closed = false;
  let applying = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    disposeTrap();
    overlay.remove();
    options.onClose();
  };

  const fail = (message: string): void => {
    error.hidden = false;
    error.textContent = message;
    applying = false;
    applyButton.disabled = false;
    applyButton.textContent = copy.apply;
  };

  const collect = (): SyncDecisions | null => {
    const decisions: {
      name?: string;
      port?: string;
      authScheme?: string;
      gatewayToken?: string;
      passthrough: Record<string, string | null>;
      models: Record<number, { delete?: boolean; values?: Record<string, string> }>;
    } = { passthrough: {}, models: {} };

    for (const row of dialog.querySelectorAll<HTMLElement>("tr[data-path]")) {
      if (row.closest(".sync-model") !== null) continue;
      const path = row.dataset.path ?? "";
      const key = row.dataset.key ?? path;
      const input = row.querySelector<HTMLInputElement | HTMLSelectElement>("[data-final]");
      if (input === null) continue;
      const isPassthrough = row.dataset.draft === "true" || plan.passthrough.some((field) => field.path === path);
      if (isPassthrough) {
        const deleted = row.querySelector<HTMLInputElement>("[data-delete]")?.checked ?? false;
        if (deleted) {
          decisions.passthrough[key] = null;
        } else if (input.value !== "") {
          decisions.passthrough[key] = input.value;
        }
        continue;
      }
      if (input.disabled) continue;
      if (path === "name") decisions.name = input.value;
      else if (path === "port") decisions.port = input.value;
      else if (path === "authScheme") decisions.authScheme = input.value;
      else if (path === "gatewayToken") decisions.gatewayToken = input.value;
    }

    for (const card of dialog.querySelectorAll<HTMLElement>(".sync-model")) {
      const index = Number(card.dataset.modelIndex);
      if (!Number.isInteger(index)) continue;
      const deleted = card.dataset.delete === "true";
      if (deleted) {
        decisions.models[index] = { delete: true };
        continue;
      }
      const values: Record<string, string> = {};
      const provider = card.querySelector<HTMLSelectElement>("[data-model-provider]");
      const upstream = card.querySelector<HTMLInputElement>("[data-model-upstream]");
      if (provider !== null) {
        if (provider.value === "") return null;
        values.provider = provider.value;
      }
      if (upstream !== null) {
        if (upstream.value.trim() === "") return null;
        values.upstreamModel = upstream.value.trim();
      }
      for (const row of card.querySelectorAll<HTMLElement>("tr[data-model-field]")) {
        const field = row.dataset.modelField;
        if (field === undefined || field === "") continue;
        const input = row.querySelector<HTMLInputElement | HTMLSelectElement>("[data-final]");
        if (input !== null) values[field] = input.value;
      }
      if (Object.keys(values).length > 0) decisions.models[index] = { values };
    }
    return decisions;
  };

  dialog.querySelector("[data-sync-close]")?.addEventListener("click", close);
  dialog.querySelector("[data-sync-back]")?.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  dialog.querySelectorAll<HTMLElement>("[data-model-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest<HTMLElement>(".sync-model");
      if (card === null) return;
      const marked = card.dataset.delete === "true";
      card.dataset.delete = marked ? "false" : "true";
      button.classList.toggle("is-armed", !marked);
    });
  });

  applyButton.addEventListener("click", () => {
    if (applying) return;
    const decisions = collect();
    if (decisions === null) {
      fail(copy.requiredProvider);
      return;
    }
    for (const card of dialog.querySelectorAll<HTMLElement>(".sync-model")) {
      if (card.dataset.status !== "claude-only" || card.dataset.delete === "true") continue;
      if ((card.querySelector<HTMLSelectElement>("[data-model-provider]")?.value ?? "") === "") {
        fail(copy.requiredProvider);
        return;
      }
      if (card.querySelector("[data-model-upstream]") !== null && card.querySelector<HTMLInputElement>("[data-model-upstream]")!.value.trim() === "") {
        fail(copy.requiredUpstream);
        return;
      }
    }
    applying = true;
    applyButton.disabled = true;
    applyButton.textContent = copy.applying;
    void options.onApply(decisions).catch((err: unknown) => {
      fail(err instanceof Error ? err.message : String(err));
    });
  });

  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  const disposeTrap = trapFocus(overlay, { initialFocus: "[data-sync-apply]" });
  return overlay;
}
