/**
 * watch：监听 Claude 侧 configLibrary 目录，事件合并后回报"有变化"。
 *
 * 只报告"发生了什么"，不判断变化内容、不写文件：调用方收到回调后自行
 * 跑 inspectClaudeChanges 取差异。目录不存在时返回空 watcher（不抛错），
 * 等目录出现后可重新调用本函数重建监听。
 */

import { watch } from "node:fs";

import { claudePaths } from "../archive/paths/index.ts";
import type { CheckOptions } from "./gate.ts";

/** 默认合并窗口：Claude 一次保存可能触发多个 fs 事件。 */
export const DEFAULT_WATCH_DEBOUNCE_MS = 300;

export interface WatchOptions extends CheckOptions {
  /** 事件合并窗口，默认 300ms；测试可调小。 */
  readonly debounceMs?: number;
}

/** 监听句柄：close 后不再回调，可安全重复调用。 */
export interface ClaudeWatcher {
  close(): void;
}

/**
 * 监听 Claude 侧 profile 目录（含 _meta.json）的变化。
 * 回调不带参数：调用方统一用 inspectClaudeChanges 取最新差异。
 */
export function watchClaudeChanges(
  opts: WatchOptions,
  listener: () => void,
): ClaudeWatcher {
  const dir = claudePaths(opts.home).configLibrary;
  const debounceMs = opts.debounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  let watcher: ReturnType<typeof watch>;
  try {
    watcher = watch(dir, { persistent: false }, () => {
      if (closed) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!closed) listener();
      }, debounceMs);
      timer.unref?.();
    });
  } catch {
    // 目录不存在 / 无权限：静默降级为空 watcher，界面仍可手动刷新。
    return { close() {} };
  }

  watcher.on("error", () => {
    // 目录被移走等运行期错误：停止回调，等待调用方重建。
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  });

  return {
    close(): void {
      if (closed) return;
      closed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      watcher.close();
    },
  };
}
