/**
 * `<usage-root>/config.json`：时区与同步频率。
 *
 * Layer 1 用 timezone 切本地桶，Layer 2 用它生成展示时间；ClockService
 * 用 syncIntervalMinutes 对齐触发边界。缺失时写入默认配置，损坏时备份后
 * 重建，非法值回落到系统时区 / 5 分钟。
 */

import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

import { atomicWriteJson, NORMAL_MODE, readJson } from "../archive/fs/index.ts";
import { isValidTimeZone, systemTimeZone } from "./time.ts";

export const SYNC_INTERVAL_CHOICES = [1, 5, 10, 15, 30] as const;

export type SyncIntervalMinutes = (typeof SYNC_INTERVAL_CHOICES)[number];

export const DEFAULT_SYNC_INTERVAL_MINUTES: SyncIntervalMinutes = 5;

export interface UsageConfig {
  readonly timezone: string;
  readonly syncIntervalMinutes: SyncIntervalMinutes;
}

export function usageConfigFile(root: string): string {
  return join(root, "config.json");
}

export function defaultUsageConfig(timezone = systemTimeZone()): UsageConfig {
  return {
    timezone: isValidTimeZone(timezone) ? timezone : "UTC",
    syncIntervalMinutes: DEFAULT_SYNC_INTERVAL_MINUTES,
  };
}

function parseInterval(value: unknown): SyncIntervalMinutes {
  return SYNC_INTERVAL_CHOICES.includes(value as SyncIntervalMinutes)
    ? (value as SyncIntervalMinutes)
    : DEFAULT_SYNC_INTERVAL_MINUTES;
}

function normalizeConfig(value: unknown): UsageConfig {
  const fallback = defaultUsageConfig();
  if (value === null || typeof value !== "object") return fallback;
  const raw = value as Record<string, unknown>;
  const timezone =
    typeof raw.timezone === "string" && isValidTimeZone(raw.timezone)
      ? raw.timezone
      : fallback.timezone;
  return { timezone, syncIntervalMinutes: parseInterval(raw.syncIntervalMinutes) };
}

function backupCorrupt(file: string): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    renameSync(file, `${file}.bak-${timestamp}`);
  } catch (error) {
    console.error(`Failed to back up corrupt usage config: ${file}`, error);
  }
}

function persist(file: string, config: UsageConfig): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  atomicWriteJson(file, config, NORMAL_MODE);
}

/** 读取配置；缺失或损坏时写入默认值并返回。 */
export function loadUsageConfig(root: string): UsageConfig {
  const file = usageConfigFile(root);
  if (!existsSync(file)) {
    const config = defaultUsageConfig();
    persist(file, config);
    return config;
  }
  try {
    return normalizeConfig(readJson(file));
  } catch {
    backupCorrupt(file);
    const config = defaultUsageConfig();
    persist(file, config);
    return config;
  }
}

/** 归一化并保存配置；返回实际写入的值。 */
export function saveUsageConfig(root: string, value: unknown): UsageConfig {
  const config = normalizeConfig(value);
  persist(usageConfigFile(root), config);
  return config;
}
