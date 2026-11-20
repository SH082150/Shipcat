/**
 * 侧栏展开状态机：固定展开（pinned）与悬停预览（preview）两套来源。
 *
 * - 点击切换 pinned；固定展开时指针离开不影响它。
 * - 收起状态下，指针停留满 hoverDelayMs（默认 1000ms）进入 preview。
 * - 按钮与面板属于同一片侧栏区域：指针从按钮移入面板时只触发
 *   pointerLeave("trigger")，此时暂不收起；pointerEnter("panel") 会取消
 *   待执行的收起计时。只有两边都不在指针下并经过 collapseDelayMs
 *   （默认 120ms，容忍浏览器 leave/enter 的先后顺序）才真正收起。
 * - 计时器全部经由可注入的 scheduler，测试用假调度器精确推进时间。
 */

export const SIDEBAR_HOVER_DELAY_MS = 1000;
export const SIDEBAR_COLLAPSE_DELAY_MS = 120;

export type SidebarRegion = "trigger" | "panel";

export interface SidebarState {
  readonly pinned: boolean;
  readonly preview: boolean;
}

export interface SidebarScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SidebarOptions {
  scheduler?: SidebarScheduler;
  hoverDelayMs?: number;
  collapseDelayMs?: number;
  initiallyPinned?: boolean;
}

export interface SidebarController {
  getState(): SidebarState;
  isExpanded(): boolean;
  /** 点击按钮：在固定展开与收起之间切换。 */
  toggle(): SidebarState;
  /** 指针进入按钮或侧栏面板；不传区域时按整片侧栏处理。 */
  pointerEnter(region?: SidebarRegion): void;
  /** 指针离开按钮或侧栏面板；整片区域都离开后才可能收起预览。 */
  pointerLeave(region?: SidebarRegion): void;
  subscribe(listener: (state: SidebarState) => void): () => void;
  dispose(): void;
}

const DEFAULT_SCHEDULER: SidebarScheduler = {
  setTimeout(callback, delayMs) {
    return globalThis.setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

export function createSidebar(options: SidebarOptions = {}): SidebarController {
  const scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
  const hoverDelayMs = options.hoverDelayMs ?? SIDEBAR_HOVER_DELAY_MS;
  const collapseDelayMs = options.collapseDelayMs ?? SIDEBAR_COLLAPSE_DELAY_MS;

  let pinned = options.initiallyPinned ?? false;
  let preview = false;
  let disposed = false;
  const inside = new Set<SidebarRegion>();
  const listeners = new Set<(state: SidebarState) => void>();

  let hoverTimer: unknown = null;
  let collapseTimer: unknown = null;

  function snapshot(): SidebarState {
    return { pinned, preview };
  }

  function emit(): void {
    if (disposed) return;
    const state = snapshot();
    for (const listener of [...listeners]) listener(state);
  }

  function clearHoverTimer(): void {
    if (hoverTimer === null) return;
    scheduler.clearTimeout(hoverTimer);
    hoverTimer = null;
  }

  function clearCollapseTimer(): void {
    if (collapseTimer === null) return;
    scheduler.clearTimeout(collapseTimer);
    collapseTimer = null;
  }

  function setPreview(next: boolean): void {
    if (preview === next) return;
    preview = next;
    emit();
  }

  function collapseIfOutside(): void {
    if (disposed || pinned || !preview || inside.size > 0) return;
    setPreview(false);
  }

  function toggle(): SidebarState {
    if (disposed) return snapshot();
    clearHoverTimer();
    clearCollapseTimer();
    pinned = !pinned;
    preview = false;
    emit();
    return snapshot();
  }

  function pointerEnter(region: SidebarRegion = "panel"): void {
    if (disposed) return;
    inside.add(region);
    clearCollapseTimer();
    if (pinned || preview || hoverTimer !== null) return;

    hoverTimer = scheduler.setTimeout(() => {
      hoverTimer = null;
      if (disposed || pinned || preview || inside.size === 0) return;
      preview = true;
      emit();
    }, hoverDelayMs);
  }

  function pointerLeave(region: SidebarRegion = "panel"): void {
    if (disposed) return;
    inside.delete(region);
    if (pinned || inside.size > 0) return;

    clearHoverTimer();
    if (!preview) return;
    if (collapseDelayMs <= 0) {
      collapseIfOutside();
      return;
    }
    if (collapseTimer !== null) return;

    collapseTimer = scheduler.setTimeout(() => {
      collapseTimer = null;
      collapseIfOutside();
    }, collapseDelayMs);
  }

  function subscribe(listener: (state: SidebarState) => void): () => void {
    if (disposed) return () => {};
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    clearHoverTimer();
    clearCollapseTimer();
    inside.clear();
    listeners.clear();
  }

  return {
    getState: snapshot,
    isExpanded: () => pinned || preview,
    toggle,
    pointerEnter,
    pointerLeave,
    subscribe,
    dispose,
  };
}
