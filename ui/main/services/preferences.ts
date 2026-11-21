/**
 * 主进程用户偏好：持久化到 userData/preferences.json。
 *
 * 只保存需要跨启动保留的开关；读取失败或字段缺失一律回落 false，
 * 写入采用临时文件 + rename，避免中途崩溃留下半个 JSON。
 */

import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { app } from "electron";

export interface Preferences {
  readonly backgroundOnClose: boolean;
  readonly hideDock: boolean;
}

const DEFAULT_PREFERENCES: Preferences = {
  backgroundOnClose: false,
  hideDock: false,
};

let cached: Preferences | null = null;

function preferencesPath(): string {
  return path.join(app.getPath("userData"), "preferences.json");
}

function normalize(value: unknown): Preferences {
  if (value === null || typeof value !== "object") return { ...DEFAULT_PREFERENCES };
  const raw = value as Record<string, unknown>;
  return {
    backgroundOnClose: raw.backgroundOnClose === true,
    hideDock: raw.hideDock === true,
  };
}

/** 启动时读取偏好；缺失、损坏或字段非法时返回默认值。 */
export async function loadPreferences(): Promise<Preferences> {
  try {
    const text = await readFile(preferencesPath(), "utf8");
    cached = normalize(JSON.parse(text));
  } catch {
    cached = { ...DEFAULT_PREFERENCES };
  }
  return cached;
}

/** 合并写回偏好；返回合并后的完整值。写入失败只记录日志，不回滚内存状态。 */
export async function savePreferences(patch: Partial<Preferences>): Promise<Preferences> {
  const base = cached ?? (await loadPreferences());
  const next: Preferences = {
    backgroundOnClose:
      typeof patch.backgroundOnClose === "boolean"
        ? patch.backgroundOnClose
        : base.backgroundOnClose,
    hideDock: typeof patch.hideDock === "boolean" ? patch.hideDock : base.hideDock,
  };
  cached = next;

  const target = preferencesPath();
  const temp = `${target}.tmp`;
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temp, target);
  } catch (error) {
    console.error("Failed to save Shipcat preferences:", error);
  }
  return next;
}
