/**
 * “更改配置文件”管理弹窗：设置窗口大小的单列弹窗，一行一个配置文件。
 *
 * “添加配置文件”点击后经 onPickFile 打开系统文件选择框，选中的文件以文件名
 * 追加为一行。添加与移除只改动本窗口内的草稿副本，不持久化；弹窗通过
 * 右上角关闭、Esc 或点击遮罩退出。
 */

import type { UsageProfileEntry } from "../state/usage-profiles.ts";

export interface ProfilePickerOptions {
  readonly profiles: readonly UsageProfileEntry[];
  /** 弹窗关闭（Esc、遮罩、取消、保存）后回调一次。 */
  onClose?: () => void;
  /**
   * 点击“添加配置文件”时调用；应打开系统文件选择框并返回所选文件路径，
   * 用户取消时返回 null。未提供时按钮不产生动作（例如纯浏览器预览）。
   */
  onPickFile?: () => Promise<string | null>;
}

export function createProfilePickerModal(options: ProfilePickerOptions): HTMLElement {
  const doc = document;
  const create = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
  ): HTMLElementTagNameMap[K] => {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    return element;
  };

  let drafts: UsageProfileEntry[] = [...options.profiles];
  let draftSeq = 0;
  let closed = false;

  const overlay = create("div", "ch-settings-overlay ch-picker-overlay");
  overlay.setAttribute("data-role", "profile-picker");
  overlay.setAttribute("aria-label", "更改配置文件");

  const dialog = create("div", "ch-picker");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  const titleId = `ch-picker-title-${Math.random().toString(36).slice(2, 8)}`;
  dialog.setAttribute("aria-labelledby", titleId);
  overlay.appendChild(dialog);

  /* ------------------------------------------------------------------ */
  /* 顶部：标题 + 添加 + 关闭                                             */
  /* ------------------------------------------------------------------ */

  const header = create("header", "ch-picker-header");

  const heading = create("div", "ch-picker-heading");
  const title = create("h2", "ch-picker-title");
  title.id = titleId;
  title.textContent = "更改配置文件";
  const subtitle = create("p", "ch-picker-subtitle");
  subtitle.textContent = "这些配置文件独立于档案，用于按接口拉取用量数据。";
  heading.append(title, subtitle);

  const headActions = create("div", "ch-picker-head-actions");

  const addButton = create("button", "ch-picker-add");
  addButton.type = "button";
  addButton.tabIndex = 0;
  addButton.setAttribute("data-role", "picker-add");
  addButton.setAttribute("data-action", "add-profile");
  addButton.textContent = "添加配置文件";
  headActions.appendChild(addButton);

  const closeButton = create("button", "ch-settings-close");
  closeButton.type = "button";
  closeButton.tabIndex = 0;
  closeButton.setAttribute("data-role", "picker-close");
  closeButton.setAttribute("aria-label", "关闭");
  const closeGlyph = create("span", "ch-settings-close-glyph");
  closeGlyph.setAttribute("aria-hidden", "true");
  closeButton.appendChild(closeGlyph);
  headActions.appendChild(closeButton);

  header.append(heading, headActions);

  /* ------------------------------------------------------------------ */
  /* 列表：一行一个配置文件                                               */
  /* ------------------------------------------------------------------ */

  const list = create("div", "ch-picker-list");
  list.setAttribute("role", "list");
  list.setAttribute("aria-label", "配置文件列表");

  /* ------------------------------------------------------------------ */
  /* 底部：说明 + 取消 / 保存                                             */
  /* ------------------------------------------------------------------ */

  const foot = create("footer", "ch-picker-foot");
  const note = create("p", "ch-picker-note");
  note.textContent = "配置文件由你编写，仅在本机读取；当前为界面原型。";
  foot.append(note);

  dialog.append(header, list, foot);

  /* ------------------------------------------------------------------ */
  /* 渲染                                                                 */
  /* ------------------------------------------------------------------ */

  const removeButtons = new Map<string, HTMLButtonElement>();

  function buildRow(draft: UsageProfileEntry): HTMLElement {
    const row = create("div", "ch-picker-row");
    row.setAttribute("role", "listitem");
    row.setAttribute("data-role", "profile-item");
    row.setAttribute("data-profile-id", draft.id);

    const text = create("div", "ch-picker-row-text");
    const name = create("span", "ch-picker-row-name");
    name.textContent = draft.name;
    const summary = create("span", "ch-picker-row-summary");
    summary.textContent = draft.summary || "待配置";
    text.append(name, summary);

    const remove = create("button", "ch-picker-remove");
    remove.type = "button";
    remove.tabIndex = 0;
    remove.setAttribute("data-role", "picker-remove");
    remove.setAttribute("data-action", "remove-profile");
    remove.setAttribute("data-profile-id", draft.id);
    remove.setAttribute("aria-label", `移除 ${draft.name}`);
    remove.textContent = "移除";
    removeButtons.set(draft.id, remove);
    remove.addEventListener("click", () => {
      drafts = drafts.filter((item) => item.id !== draft.id);
      render();
    });

    row.append(text, remove);
    return row;
  }

  function buildEmpty(): HTMLElement {
    const empty = create("div", "ch-picker-empty");
    const emptyTitle = create("p", "ch-picker-empty-title");
    emptyTitle.textContent = "还没有配置文件";
    const emptyHint = create("p", "ch-picker-empty-hint");
    emptyHint.textContent = "点击右上角“添加配置文件”开始。";
    empty.append(emptyTitle, emptyHint);
    return empty;
  }

  let renderedRows: HTMLElement[] = [];

  function render(): void {
    for (const row of renderedRows) row.remove();
    renderedRows = [];
    removeButtons.clear();
    if (drafts.length === 0) {
      const empty = buildEmpty();
      list.appendChild(empty);
      renderedRows.push(empty);
      return;
    }
    for (const draft of drafts) {
      const row = buildRow(draft);
      list.appendChild(row);
      renderedRows.push(row);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 添加与关闭                                                           */
  /* ------------------------------------------------------------------ */

  let picking = false;

  addButton.addEventListener("click", () => {
    if (picking) return;
    const pick = options.onPickFile;
    if (!pick) return;

    picking = true;
    addButton.disabled = true;
    void pick()
      .then((filePath) => {
        if (!filePath) return;
        const name = filePath.split(/[\\/]/).pop() || "配置文件";
        const draft: UsageProfileEntry = {
          id: `file-usage-profile-${++draftSeq}`,
          name,
          summary: filePath,
        };
        drafts = [...drafts, draft];
        render();
        removeButtons.get(draft.id)?.focus();
      })
      .finally(() => {
        picking = false;
        addButton.disabled = false;
      });
  });

  function close(): void {
    if (closed) return;
    closed = true;
    overlay.remove();
    options.onClose?.();
  }

  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener("keydown", (event) => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  });

  render();

  return overlay;
}
