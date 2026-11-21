/**
 * 页面通用动作的纯逻辑：app.ts 的事件委托只负责找到目标元素，
 * 状态判断集中在这里，便于单测。
 */

/**
 * 事件委托只认这些属性。容器自身的视图状态一律写成 data-view-*，
 * 不得使用这里列出的属性，否则点击容器空白处会被误判为动作目标。
 */
export const ACTION_ATTRIBUTES = [
  "data-action",
  "data-page",
  "data-language",
  "data-route",
  "data-usage-range",
] as const;

export const ACTION_SELECTOR = ACTION_ATTRIBUTES.map((attribute) => `[${attribute}]`).join(", ");

interface ContainsLike {
  contains?(node: unknown): boolean;
}

function contains(container: unknown, node: unknown): boolean {
  if (container === null || typeof container !== "object") return false;
  const method = (container as ContainsLike).contains;
  return typeof method === "function" && method.call(container, node) === true;
}

/**
 * shell 容器（#app、.app-shell、侧栏槽、workspace）永远不是动作目标。
 * 判定只向上看：目标本身就是容器，或目标是包含容器的祖先。
 * 容器内部的按钮/行仍然是正常动作目标，不能因为“在侧栏里”被排除。
 */
export function isShellContainer(candidate: unknown, containers: readonly unknown[]): boolean {
  return containers.some(
    (container) => container === candidate || contains(candidate, container),
  );
}

export function resolvePageExport<T>(module: unknown, name: string): T | null {
  if (module === null || typeof module !== "object") return null;
  const candidate = (module as Record<string, unknown>)[name];
  return typeof candidate === "function" ? (candidate as T) : null;
}
