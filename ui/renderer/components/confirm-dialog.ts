/**
 * 设置风格的确认弹窗：只负责结构与关闭；焦点陷阱由调用方在挂载后接管，
 * 确认/取消动作经回调上抛。
 */

export interface ConfirmDialogOptions {
  readonly title: string;
  readonly message?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly tone?: "default" | "danger";
  onConfirm?: () => void;
  onClose?: () => void;
}

let confirmSeq = 0;

export function createConfirmDialog(options: ConfirmDialogOptions): HTMLElement {
  const doc = document;
  const create = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
  ): HTMLElementTagNameMap[K] => {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    return element;
  };

  const seq = ++confirmSeq;
  const titleId = `ch-confirm-title-${seq}`;
  let closed = false;

  const overlay = create("div", "ch-settings-overlay ch-confirm-overlay");
  overlay.setAttribute("data-role", "confirm-dialog");
  const dialog = create("div", "ch-confirm");
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", titleId);
  overlay.appendChild(dialog);

  const title = create("h2", "ch-confirm-title");
  title.id = titleId;
  title.textContent = options.title;
  dialog.appendChild(title);

  if (options.message) {
    const message = create("p", "ch-confirm-message");
    message.textContent = options.message;
    dialog.appendChild(message);
  }

  const actions = create("div", "ch-confirm-actions");
  const cancel = create("button", "ch-confirm-button");
  cancel.type = "button";
  cancel.setAttribute("data-role", "confirm-cancel");
  cancel.textContent = options.cancelLabel ?? "取消";
  const confirm = create(
    "button",
    `ch-confirm-button ch-confirm-button--primary${options.tone === "danger" ? " ch-confirm-button--danger" : ""}`,
  );
  confirm.type = "button";
  confirm.setAttribute("data-role", "confirm-accept");
  confirm.textContent = options.confirmLabel ?? "确认";
  actions.append(cancel, confirm);
  dialog.appendChild(actions);

  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    options.onClose?.();
  };

  cancel.addEventListener("click", close);
  confirm.addEventListener("click", () => {
    options.onConfirm?.();
    close();
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });

  // 供样式与测试读取；不参与逻辑。
  overlay.setAttribute("data-tone", options.tone ?? "default");
  return overlay;
}
