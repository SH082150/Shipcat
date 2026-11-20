/**
 * 模态焦点管理：把 Tab / Shift+Tab 限制在容器内，并在释放时归还焦点。
 *
 * 调用方在把弹窗挂到 DOM 之后调用，关闭弹窗时执行返回的 dispose。
 * 只处理键盘循环与焦点归还，不改变弹窗自身的关闭逻辑。
 */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export interface FocusTrapOptions {
  /** 初始焦点选择器；缺省取容器内第一个可聚焦元素。 */
  readonly initialFocus?: string;
}

function focusableItems(container: HTMLElement): HTMLElement[] {
  if (typeof container.querySelectorAll !== "function") return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      typeof element.getClientRects !== "function" || element.getClientRects().length > 0,
  );
}

export function trapFocus(container: HTMLElement, options: FocusTrapOptions = {}): () => void {
  const doc = container.ownerDocument;
  const previous = doc.activeElement as HTMLElement | null;
  let disposed = false;

  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Tab") return;
    const items = focusableItems(container);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = doc.activeElement;
    const inside = active instanceof Node && container.contains(active);

    if (!inside) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  container.addEventListener("keydown", handleKeydown as EventListener);
  const schedule =
    typeof globalThis.requestAnimationFrame === "function"
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : (callback: () => void) => globalThis.setTimeout(callback, 0);
  schedule(() => {
    if (disposed) return;
    const target =
      options.initialFocus && typeof container.querySelector === "function"
        ? container.querySelector<HTMLElement>(options.initialFocus)
        : focusableItems(container)[0];
    target?.focus();
  });

  return () => {
    if (disposed) return;
    disposed = true;
    container.removeEventListener("keydown", handleKeydown as EventListener);
    if (previous && previous.isConnected) previous.focus();
  };
}
