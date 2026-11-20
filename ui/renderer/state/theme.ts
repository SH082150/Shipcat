/**
 * 主题偏好：light / dark / system 三态，system 跟随 prefers-color-scheme。
 *
 * 存储与媒体查询都可注入：生产环境默认读取 localStorage 与
 * matchMedia("(prefers-color-scheme: dark)")，Node 测试传内存实现即可。
 * 读写存储失败（隐私模式、配额）只降级为不持久化，不影响内存中的主题。
 * 控制器只负责偏好与解析结果；把 data-theme 写到根元素由 app.ts 完成。
 */

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME: ThemePreference = "system";
export const THEME_STORAGE_KEY = "claudeharbor.theme";
export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThemeMediaQuery {
  readonly matches: boolean;
  addEventListener?(
    type: "change",
    listener: (event: { matches: boolean }) => void,
  ): void;
  removeEventListener?(
    type: "change",
    listener: (event: { matches: boolean }) => void,
  ): void;
}

export interface ThemeSnapshot {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
}

export interface ThemeOptions {
  /** 传 null 关闭持久化；不传则尝试使用 globalThis.localStorage。 */
  storage?: ThemeStorage | null;
  /** 传 null 表示没有系统主题信号；不传则尝试使用 matchMedia。 */
  media?: ThemeMediaQuery | null;
  storageKey?: string;
}

export interface ThemeController {
  getPreference(): ThemePreference;
  getResolved(): ResolvedTheme;
  /** 非法值被忽略，返回当前偏好。 */
  setPreference(value: unknown): ThemePreference;
  /** light → dark → system → light。 */
  cycle(): ThemePreference;
  subscribe(listener: (snapshot: ThemeSnapshot) => void): () => void;
  dispose(): void;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" &&
    (THEME_PREFERENCES as readonly string[]).includes(value)
  );
}

export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}

export function cycleTheme(preference: ThemePreference): ThemePreference {
  const index = THEME_PREFERENCES.indexOf(preference);
  return THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length] ?? DEFAULT_THEME;
}

function detectStorage(): ThemeStorage | null {
  try {
    return (globalThis as { localStorage?: ThemeStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function detectMedia(): ThemeMediaQuery | null {
  try {
    const matchMedia = (globalThis as {
      matchMedia?: (query: string) => ThemeMediaQuery;
    }).matchMedia;
    if (typeof matchMedia !== "function") return null;
    return matchMedia.call(globalThis, DARK_SCHEME_QUERY) ?? null;
  } catch {
    return null;
  }
}

function readPreference(
  storage: ThemeStorage | null,
  key: string,
): ThemePreference {
  if (storage === null) return DEFAULT_THEME;
  try {
    const stored = storage.getItem(key);
    return isThemePreference(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function createTheme(options: ThemeOptions = {}): ThemeController {
  const storage = options.storage === undefined ? detectStorage() : options.storage;
  const media = options.media === undefined ? detectMedia() : options.media;
  const key = options.storageKey ?? THEME_STORAGE_KEY;

  let preference = readPreference(storage, key);
  let resolved = resolveTheme(preference, media?.matches ?? false);
  let disposed = false;
  const listeners = new Set<(snapshot: ThemeSnapshot) => void>();

  function snapshot(): ThemeSnapshot {
    return { preference, resolved };
  }

  function emit(): void {
    if (disposed) return;
    const state = snapshot();
    for (const listener of [...listeners]) listener(state);
  }

  function persist(next: ThemePreference): void {
    if (storage === null) return;
    try {
      storage.setItem(key, next);
    } catch {
      // 存储不可用（隐私模式/配额）时保持内存状态即可。
    }
  }

  function setPreference(value: unknown): ThemePreference {
    if (!isThemePreference(value) || value === preference) return preference;
    preference = value;
    resolved = resolveTheme(preference, media?.matches ?? false);
    persist(preference);
    emit();
    return preference;
  }

  const onMediaChange = (event: { matches: boolean }): void => {
    if (disposed || preference !== "system") return;
    const next = resolveTheme(preference, event.matches);
    if (next === resolved) return;
    resolved = next;
    emit();
  };

  if (media?.addEventListener) {
    media.addEventListener("change", onMediaChange);
  }

  function subscribe(listener: (snapshot: ThemeSnapshot) => void): () => void {
    if (disposed) return () => {};
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (media?.removeEventListener) {
      media.removeEventListener("change", onMediaChange);
    }
    listeners.clear();
  }

  return {
    getPreference: () => preference,
    getResolved: () => resolved,
    setPreference,
    cycle: () => setPreference(cycleTheme(preference)),
    subscribe,
    dispose,
  };
}
