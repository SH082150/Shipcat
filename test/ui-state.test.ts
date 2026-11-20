/**
 * 导航、侧栏与主题逻辑与 DOM 无关，只依赖注入的调度器、存储与媒体查询，
 * 因此可在 Node 测试里确定性地覆盖。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PAGE,
  PAGE_IDS,
  isPageId,
  navigate,
} from "../ui/renderer/state/navigation.ts";
import {
  SIDEBAR_COLLAPSE_DELAY_MS,
  SIDEBAR_HOVER_DELAY_MS,
  createSidebar,
} from "../ui/renderer/state/sidebar.ts";
import {
  DEFAULT_THEME,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  createTheme,
  cycleTheme,
  isThemePreference,
  resolveTheme,
} from "../ui/renderer/state/theme.ts";
import type {
  SidebarScheduler,
  SidebarState,
} from "../ui/renderer/state/sidebar.ts";
import type { ThemeMediaQuery, ThemeStorage } from "../ui/renderer/state/theme.ts";

/** 可手动推进的假调度器：到期任务按时间顺序执行，便于断言 1000ms 边界。 */
function createFakeScheduler(): {
  scheduler: SidebarScheduler;
  advance(ms: number): void;
  pending(): number;
} {
  let now = 0;
  let nextId = 1;
  const tasks = new Map<number, { at: number; run: () => void }>();

  return {
    scheduler: {
      setTimeout(run: () => void, delayMs: number): unknown {
        const id = nextId++;
        tasks.set(id, { at: now + Math.max(0, delayMs), run });
        return id;
      },
      clearTimeout(handle: unknown): void {
        tasks.delete(handle as number);
      },
    },
    advance(ms: number): void {
      const target = now + ms;
      for (;;) {
        let next: [number, { at: number; run: () => void }] | null = null;
        for (const entry of tasks) {
          if (entry[1].at <= target && (next === null || entry[1].at < next[1].at)) {
            next = entry;
          }
        }
        if (next === null) break;
        tasks.delete(next[0]);
        now = next[1].at;
        next[1].run();
      }
      now = target;
    },
    pending(): number {
      return tasks.size;
    },
  };
}

function expanded(state: SidebarState): boolean {
  return state.pinned || state.preview;
}

function createTestSidebar(): {
  sidebar: ReturnType<typeof createSidebar>;
  advance(ms: number): void;
  pending(): number;
} {
  const fake = createFakeScheduler();
  const sidebar = createSidebar({ scheduler: fake.scheduler });
  return { sidebar, advance: fake.advance, pending: fake.pending };
}

/** 内存版 localStorage，满足 ThemeStorage 结构。 */
function createMemoryStorage(initial?: Record<string, string>): {
  storage: ThemeStorage;
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    storage: {
      getItem(key: string): string | null {
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string): void {
        values.set(key, value);
      },
    },
    values,
  };
}

/** 假 prefers-color-scheme 媒体查询，可切换并广播 change。 */
function createFakeMedia(initial: boolean): {
  media: ThemeMediaQuery;
  set(matches: boolean): void;
  listenerCount(): number;
} {
  let matches = initial;
  const listeners = new Set<(event: { matches: boolean }) => void>();
  return {
    media: {
      get matches(): boolean {
        return matches;
      },
      addEventListener(_type, listener): void {
        listeners.add(listener);
      },
      removeEventListener(_type, listener): void {
        listeners.delete(listener);
      },
    },
    set(next: boolean): void {
      matches = next;
      for (const listener of [...listeners]) listener({ matches });
    },
    listenerCount(): number {
      return listeners.size;
    },
  };
}

test("navigation: 只有四个合法页，默认 overview", () => {
  assert.deepEqual([...PAGE_IDS], ["overview", "providers", "profiles", "usage"]);
  assert.equal(DEFAULT_PAGE, "overview");
  for (const page of PAGE_IDS) assert.equal(isPageId(page), true);
  for (const value of ["settings", "", null, undefined, 1, {}]) {
    assert.equal(isPageId(value), false);
  }
});

test("navigation: navigate 只返回合法页，非法输入回落到 overview", () => {
  for (const page of PAGE_IDS) assert.equal(navigate(page), page);
  assert.equal(navigate("providers"), "providers");
  assert.equal(navigate("nope"), "overview");
  assert.equal(navigate(null), "overview");
  assert.equal(navigate(undefined), "overview");
  assert.equal(navigate({ page: "usage" }), "overview");
  assert.equal(navigate("../usage"), "overview");
});

test("sidebar: 初始收起，点击在固定展开/收起之间切换", () => {
  const { sidebar } = createTestSidebar();
  assert.deepEqual(sidebar.getState(), { pinned: false, preview: false });
  assert.equal(sidebar.isExpanded(), false);

  assert.deepEqual(sidebar.toggle(), { pinned: true, preview: false });
  assert.equal(sidebar.isExpanded(), true);

  assert.deepEqual(sidebar.toggle(), { pinned: false, preview: false });
  assert.equal(sidebar.isExpanded(), false);
});

test("sidebar: 收起时悬停 1000ms 才临时展开", () => {
  const { sidebar, advance } = createTestSidebar();

  sidebar.pointerEnter("trigger");
  advance(SIDEBAR_HOVER_DELAY_MS - 1);
  assert.deepEqual(sidebar.getState(), { pinned: false, preview: false });
  assert.equal(sidebar.isExpanded(), false);

  advance(1);
  assert.deepEqual(sidebar.getState(), { pinned: false, preview: true });
  assert.equal(sidebar.isExpanded(), true);
});

test("sidebar: 悬停未满 1000ms 就离开则取消临时展开", () => {
  const { sidebar, advance, pending } = createTestSidebar();

  sidebar.pointerEnter("trigger");
  advance(SIDEBAR_HOVER_DELAY_MS - 100);
  sidebar.pointerLeave("trigger");
  assert.equal(pending(), 0);

  advance(5000);
  assert.deepEqual(sidebar.getState(), { pinned: false, preview: false });
  assert.equal(sidebar.isExpanded(), false);
});

test("sidebar: 指针从按钮移入侧栏后保持临时展开", () => {
  const { sidebar, advance } = createTestSidebar();

  sidebar.pointerEnter("trigger");
  advance(SIDEBAR_HOVER_DELAY_MS);
  assert.equal(sidebar.getState().preview, true);

  // 浏览器的真实顺序：先离开按钮，再进入面板；宽限期内不得收起。
  sidebar.pointerLeave("trigger");
  sidebar.pointerEnter("panel");
  advance(SIDEBAR_COLLAPSE_DELAY_MS * 4);
  assert.deepEqual(sidebar.getState(), { pinned: false, preview: true });
  assert.equal(sidebar.isExpanded(), true);
});

test("sidebar: 离开整个侧栏区域后取消临时展开", () => {
  const { sidebar, advance } = createTestSidebar();

  sidebar.pointerEnter("trigger");
  advance(SIDEBAR_HOVER_DELAY_MS);
  sidebar.pointerEnter("panel");
  sidebar.pointerLeave("trigger");
  advance(SIDEBAR_COLLAPSE_DELAY_MS);
  assert.equal(sidebar.getState().preview, true);

  sidebar.pointerLeave("panel");
  advance(SIDEBAR_COLLAPSE_DELAY_MS);
  assert.deepEqual(sidebar.getState(), { pinned: false, preview: false });
  assert.equal(sidebar.isExpanded(), false);
});

test("sidebar: 固定展开不随指针离开收起", () => {
  const { sidebar, advance, pending } = createTestSidebar();

  sidebar.toggle();
  assert.equal(sidebar.getState().pinned, true);

  sidebar.pointerEnter("panel");
  advance(SIDEBAR_HOVER_DELAY_MS);
  sidebar.pointerLeave("panel");
  advance(SIDEBAR_COLLAPSE_DELAY_MS * 4);

  assert.deepEqual(sidebar.getState(), { pinned: true, preview: false });
  assert.equal(sidebar.isExpanded(), true);
  assert.equal(pending(), 0);
});

test("sidebar: 取消固定后完全收起，且需重新进入才再次悬停展开", () => {
  const { sidebar, advance } = createTestSidebar();

  sidebar.pointerEnter("trigger");
  advance(SIDEBAR_HOVER_DELAY_MS);
  assert.equal(sidebar.getState().preview, true);

  sidebar.toggle();
  assert.deepEqual(sidebar.getState(), { pinned: true, preview: false });
  sidebar.toggle();
  assert.deepEqual(sidebar.getState(), { pinned: false, preview: false });

  advance(SIDEBAR_HOVER_DELAY_MS * 2);
  assert.deepEqual(sidebar.getState(), { pinned: false, preview: false });
});

test("sidebar: 订阅者收到状态变化，退订后不再收到", () => {
  const { sidebar, advance } = createTestSidebar();
  const seen: SidebarState[] = [];
  const unsubscribe = sidebar.subscribe((state) => seen.push(state));

  sidebar.pointerEnter("trigger");
  advance(SIDEBAR_HOVER_DELAY_MS);
  sidebar.pointerLeave("trigger");
  advance(SIDEBAR_COLLAPSE_DELAY_MS);
  assert.deepEqual(seen, [
    { pinned: false, preview: true },
    { pinned: false, preview: false },
  ]);

  unsubscribe();
  sidebar.toggle();
  assert.equal(seen.length, 2);
});

test("sidebar: dispose 清理计时器，之后不再更新状态", () => {
  const { sidebar, advance, pending } = createTestSidebar();
  let changes = 0;
  sidebar.subscribe(() => {
    changes += 1;
  });

  sidebar.pointerEnter("trigger");
  sidebar.dispose();
  assert.equal(pending(), 0);

  advance(SIDEBAR_HOVER_DELAY_MS * 2);
  assert.deepEqual(sidebar.getState(), { pinned: false, preview: false });
  assert.equal(changes, 0);
});

test("theme: 偏好类型与纯函数解析", () => {
  assert.deepEqual([...THEME_PREFERENCES], ["light", "dark", "system"]);
  assert.equal(DEFAULT_THEME, "system");
  for (const value of THEME_PREFERENCES) assert.equal(isThemePreference(value), true);
  for (const value of ["auto", "", null, 1]) assert.equal(isThemePreference(value), false);

  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("theme: cycle 在 light → dark → system 之间循环", () => {
  assert.equal(cycleTheme("light"), "dark");
  assert.equal(cycleTheme("dark"), "system");
  assert.equal(cycleTheme("system"), "light");
});

test("theme: 默认 system，无媒体查询时解析为 light", () => {
  const theme = createTheme({ storage: null, media: null });
  assert.equal(theme.getPreference(), "system");
  assert.equal(theme.getResolved(), "light");
});

test("theme: 从存储恢复偏好，非法值回落到 system", () => {
  const valid = createMemoryStorage({ [THEME_STORAGE_KEY]: "dark" });
  const fromValid = createTheme({ storage: valid.storage, media: null });
  assert.equal(fromValid.getPreference(), "dark");
  assert.equal(fromValid.getResolved(), "dark");

  const invalid = createMemoryStorage({ [THEME_STORAGE_KEY]: "sepia" });
  const fromInvalid = createTheme({ storage: invalid.storage, media: null });
  assert.equal(fromInvalid.getPreference(), "system");
  assert.equal(fromInvalid.getResolved(), "light");
});

test("theme: setPreference/cycle 持久化并只接受合法值", () => {
  const { storage, values } = createMemoryStorage();
  const theme = createTheme({ storage, media: null });

  assert.equal(theme.setPreference("dark"), "dark");
  assert.equal(theme.getResolved(), "dark");
  assert.equal(values.get(THEME_STORAGE_KEY), "dark");

  assert.equal(theme.setPreference("neon"), "dark");
  assert.equal(values.get(THEME_STORAGE_KEY), "dark");

  assert.equal(theme.cycle(), "system");
  assert.equal(values.get(THEME_STORAGE_KEY), "system");
  assert.equal(theme.getResolved(), "light");
});

test("theme: system 跟随 prefers-color-scheme 变化并通知订阅者", () => {
  const fake = createFakeMedia(false);
  const theme = createTheme({ storage: null, media: fake.media });
  const seen: string[] = [];
  theme.subscribe((snapshot) => seen.push(`${snapshot.preference}:${snapshot.resolved}`));

  assert.equal(theme.getResolved(), "light");
  fake.set(true);
  assert.equal(theme.getResolved(), "dark");
  assert.deepEqual(seen, ["system:dark"]);

  fake.set(false);
  assert.equal(theme.getResolved(), "light");
  assert.deepEqual(seen, ["system:dark", "system:light"]);
});

test("theme: 显式 light/dark 不受系统主题影响", () => {
  const fake = createFakeMedia(false);
  const theme = createTheme({ storage: null, media: fake.media });
  theme.setPreference("dark");

  let changes = 0;
  theme.subscribe(() => {
    changes += 1;
  });

  fake.set(true);
  fake.set(false);
  assert.equal(theme.getResolved(), "dark");
  assert.equal(changes, 0);
});

test("theme: 存储读写抛错时仍在内存中工作", () => {
  const broken: ThemeStorage = {
    getItem(): string | null {
      throw new Error("SecurityError");
    },
    setItem(): void {
      throw new Error("QuotaExceededError");
    },
  };
  const theme = createTheme({ storage: broken, media: null });

  assert.equal(theme.getPreference(), "system");
  assert.equal(theme.setPreference("light"), "light");
  assert.equal(theme.getResolved(), "light");
  assert.equal(theme.cycle(), "dark");
  assert.equal(theme.getResolved(), "dark");
});

test("theme: dispose 移除媒体监听，之后不再通知", () => {
  const fake = createFakeMedia(false);
  const theme = createTheme({ storage: null, media: fake.media });
  let changes = 0;
  theme.subscribe(() => {
    changes += 1;
  });
  assert.equal(fake.listenerCount(), 1);

  theme.dispose();
  assert.equal(fake.listenerCount(), 0);
  fake.set(true);
  assert.equal(changes, 0);
  assert.equal(theme.getResolved(), "light");
});
