/**
 * 用户配置 settings.json：默认来源、损坏备份、原子写入。
 *
 * 本阶段只关心 usage.sources。缺失时写入默认配置；JSON 损坏时先备份为
 * settings.json.bak-<时间戳>，再写默认值。字段非法一律回落到默认语义。
 */

import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

import { applyFileMode, atomicWriteJson, SECRET_MODE } from "../archive/fs/index.ts";
import { resolveHome } from "../platform/index.ts";
import type { PlatformOptions } from "../platform/index.ts";
import { settingsFile } from "./paths.ts";

export interface SettingsSource {
  readonly id: string;
  readonly kind: string;
  /** Claude-3p 数据根或 sessions 根；null = 按平台自动探测。 */
  readonly root: string | null;
  readonly enabled: boolean;
}

export interface Settings {
  readonly version: 1;
  readonly usage: {
    readonly sources: readonly SettingsSource[];
  };
}

export const DEFAULT_SOURCE: SettingsSource = {
  id: "claude-desktop",
  kind: "claude-desktop",
  root: null,
  enabled: true,
};

export function defaultSettings(): Settings {
  return {
    version: 1,
    usage: { sources: [{ ...DEFAULT_SOURCE }] },
  };
}

function normalizeRoot(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && isAbsolute(trimmed) ? trimmed : null;
}

function normalizeSource(value: unknown): SettingsSource | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (id.length === 0) return null;
  const kind =
    typeof raw.kind === "string" && raw.kind.trim().length > 0
      ? raw.kind.trim()
      : DEFAULT_SOURCE.kind;
  return {
    id,
    kind,
    root: normalizeRoot(raw.root),
    enabled: raw.enabled !== false,
  };
}

/** 把任意 JSON 归一成合法配置；结构不可用时返回默认值。 */
export function normalizeSettings(value: unknown): Settings {
  if (value === null || typeof value !== "object") return defaultSettings();
  const raw = value as Record<string, unknown>;
  const usage = raw.usage;
  if (usage === null || typeof usage !== "object") return defaultSettings();
  const rawSources = (usage as Record<string, unknown>).sources;
  if (!Array.isArray(rawSources)) return defaultSettings();

  const seen = new Set<string>();
  const sources: SettingsSource[] = [];
  for (const item of rawSources) {
    const source = normalizeSource(item);
    if (source === null || seen.has(source.id)) continue;
    seen.add(source.id);
    sources.push(source);
  }
  if (sources.length === 0) return defaultSettings();
  return { version: 1, usage: { sources } };
}

function ensureParent(file: string): void {
  const directory = dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  applyFileMode(directory, 0o700);
}

function persist(settings: Settings, file: string): void {
  ensureParent(file);
  atomicWriteJson(file, settings, SECRET_MODE);
  applyFileMode(file, SECRET_MODE);
}

function backupCorrupt(file: string): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    renameSync(file, `${file}.bak-${timestamp}`);
  } catch (error) {
    console.error(`Failed to back up corrupt settings file: ${file}`, error);
  }
}

/** 读取配置；缺失或损坏时写入默认值并返回。 */
export function loadSettings(
  home: string = resolveHome(),
  opts?: PlatformOptions,
): Settings {
  const file = settingsFile(home, opts);
  if (!existsSync(file)) {
    const settings = defaultSettings();
    persist(settings, file);
    return settings;
  }

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return normalizeSettings(parsed);
  } catch (error) {
    console.warn(`Invalid settings file, backing up and recreating: ${file}`, error);
    backupCorrupt(file);
    const settings = defaultSettings();
    persist(settings, file);
    return settings;
  }
}

/** 归一后原子写回；返回实际写入的值。 */
export function saveSettings(
  settings: Settings,
  home: string = resolveHome(),
  opts?: PlatformOptions,
): Settings {
  const normalized = normalizeSettings(settings);
  persist(normalized, settingsFile(home, opts));
  return normalized;
}
