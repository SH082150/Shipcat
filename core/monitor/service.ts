/**
 * Monitor 服务：持续 watch + 30s 兜底 + 单轮同步 + 用户手动全量重建。
 *
 * watch 在运行期间始终打开。通知、兜底和手动刷新只调用 requestSync；
 * IDLE/SYNCING/pending 负责合并唤醒，任何回调都不直接写数据库。
 */

import { rmSync, watch as watchFs } from "node:fs";
import type { FSWatcher } from "node:fs";
import { dirname, join } from "node:path";

import { loadUsageConfig } from "../usage/config.ts";
import { listOfficialLedgerFiles, usageRoot } from "../usage/paths/index.ts";
import { activeMonitorProfile } from "./profile.ts";
import { syncMonitorLayer1 } from "./sync.ts";
import type {
  MonitorRecordEvent,
  MonitorSyncReason,
  MonitorSyncSummary,
} from "./types.ts";

export type MonitorLifecycleState = "IDLE" | "SYNCING" | "REBUILDING" | "STOPPED";

export interface MonitorSourceResolution {
  readonly root: string | null;
  readonly warnings?: readonly string[];
}

export interface MonitorServiceOptions {
  readonly monitorRoot: string;
  readonly sourceRoot: () => MonitorSourceResolution;
  /** 档案和 Claude appliedId 都从这个 home 推导。 */
  readonly home?: string;
  /** 客户端未运行时，新记录统一归为 unknown。 */
  readonly clientRunning?: () => boolean;
  readonly now?: () => number;
  /** 测试可关闭 watch 与兜底；手动同步仍可使用。 */
  readonly watch?: boolean;
  readonly fallbackMs?: number;
}

export class MonitorService {
  private readonly root: string;
  private readonly resolveSourceRoot: () => MonitorSourceResolution;
  private readonly home?: string;
  private readonly clientRunning: () => boolean;
  private readonly now: () => number;
  private readonly watchEnabled: boolean;
  private readonly fallbackMs: number;
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly recordListeners = new Set<(event: MonitorRecordEvent) => void>();

  private fallbackTimer: NodeJS.Timeout | null = null;
  private running: Promise<MonitorSyncSummary> | null = null;
  private rebuilding: Promise<MonitorSyncSummary> | null = null;
  private state: MonitorLifecycleState = "IDLE";
  private pending = false;
  private rebuildRequested = false;
  private disposed = false;

  constructor(options: MonitorServiceOptions) {
    this.root = options.monitorRoot;
    this.resolveSourceRoot = options.sourceRoot;
    this.home = options.home;
    this.clientRunning = options.clientRunning ?? (() => true);
    this.now = options.now ?? (() => Date.now());
    this.watchEnabled = options.watch !== false;
    this.fallbackMs = options.fallbackMs ?? 30_000;
  }

  /** 打开 watch 和兜底，并立即执行一次普通读取。 */
  async start(): Promise<MonitorSyncSummary> {
    if (this.disposed) throw new Error("MonitorService is disposed");
    // 旧版独立偏移配置已废弃，时区统一来自 usage 配置。
    try {
      rmSync(join(this.root, "config.json"), { force: true });
    } catch (error) {
      console.warn("Failed to remove legacy monitor config:", error);
    }
    if (this.watchEnabled) {
      this.refreshWatchers();
      if (this.fallbackTimer === null) {
        this.fallbackTimer = setInterval(() => {
          void this.requestSync("fallback").catch((error) => {
            console.error("Monitor fallback sync failed:", error);
          });
        }, this.fallbackMs);
        this.fallbackTimer.unref?.();
      }
    }
    return this.requestSync("startup");
  }

  /** 唯一唤醒入口；状态在第一次 await 前改变，避免 watch/兜底竞态。 */
  requestSync(reason: MonitorSyncReason): Promise<MonitorSyncSummary> {
    if (this.disposed || this.state === "STOPPED") {
      return Promise.reject(new Error("MonitorService is disposed"));
    }
    if (this.rebuilding !== null || this.rebuildRequested) {
      this.pending = true;
      if (this.rebuilding !== null) return this.rebuilding;
      return Promise.resolve(this.emptySummary(reason, ["Monitor 正在等待重建。"]));
    }
    if (this.running !== null) {
      this.pending = true;
      return this.running;
    }

    this.state = "SYNCING";
    const run = this.run(reason, false);
    this.running = run;
    run.then(
      () => this.finishSync(),
      () => this.finishSync(),
    );
    return run;
  }

  /** 仅由用户显式调用；等待当前同步结束后执行全量 unknown 重建。 */
  rebuild(): Promise<MonitorSyncSummary> {
    if (this.disposed || this.state === "STOPPED") {
      return Promise.reject(new Error("MonitorService is disposed"));
    }
    if (this.rebuilding !== null) return this.rebuilding;

    this.rebuildRequested = true;
    const run = (async () => {
      if (this.running !== null) {
        try {
          await this.running;
        } catch {
          // 当前同步失败不阻止用户主动重建。
        }
      }
      this.state = "REBUILDING";
      return this.run("rebuild", true);
    })();
    this.rebuilding = run;
    run.then(
      () => this.finishRebuild(),
      () => this.finishRebuild(),
    );
    return run;
  }

  /** Monitor 文件库根，供查询层读取历史。 */
  getRoot(): string {
    return this.root;
  }

  /** 订阅提交成功的新记录；返回幂等取消函数。 */
  onRecord(listener: (event: MonitorRecordEvent) => void): () => void {
    this.recordListeners.add(listener);
    return () => {
      this.recordListeners.delete(listener);
    };
  }

  getLifecycleState(): MonitorLifecycleState {
    return this.state;
  }

  dispose(): void {
    this.disposed = true;
    this.state = "STOPPED";
    this.pending = false;
    if (this.fallbackTimer !== null) clearInterval(this.fallbackTimer);
    this.fallbackTimer = null;
    for (const watcher of this.watchers.values()) {
      try {
        watcher.close();
      } catch {
        // watcher 已失效。
      }
    }
    this.watchers.clear();
    this.recordListeners.clear();
  }

  private finishSync(): void {
    this.running = null;
    if (this.disposed) return;
    if (!this.rebuildRequested) this.state = "IDLE";
    if (this.pending && !this.rebuildRequested) {
      this.pending = false;
      void this.requestSync("pending").catch((error) => {
        console.error("Monitor pending sync failed:", error);
      });
    }
  }

  private finishRebuild(): void {
    this.rebuilding = null;
    this.rebuildRequested = false;
    if (this.disposed) return;
    this.state = "IDLE";
    if (this.pending) {
      this.pending = false;
      void this.requestSync("pending").catch((error) => {
        console.error("Monitor post-rebuild sync failed:", error);
      });
    }
  }

  private async run(
    reason: MonitorSyncReason | "rebuild",
    rebuild: boolean,
  ): Promise<MonitorSyncSummary> {
    const resolved = this.resolveSourceRoot();
    const sourceWarnings = resolved.warnings ?? [];
    if (resolved.root === null && !rebuild) {
      return this.emptySummary(reason, [
        ...sourceWarnings,
        "未配置 Monitor 数据源，本轮未同步。",
      ]);
    }

    const timeZone = loadUsageConfig(usageRoot(this.home)).timezone;
    let clientRunning = false;
    try {
      clientRunning = this.clientRunning();
    } catch {
      clientRunning = false;
    }
    const profile = rebuild
      ? null
      : activeMonitorProfile(this.home, clientRunning);
    const result = syncMonitorLayer1({
      root: this.root,
      sourceRoot: resolved.root ?? "",
      timeZone,
      profile,
      rebuild,
      now: this.now,
      onRecord: (event) => {
        for (const listener of this.recordListeners) {
          try {
            listener(event);
          } catch (error) {
            console.error("Monitor record listener failed:", error);
          }
        }
      },
    });

    if (this.watchEnabled && !this.disposed) this.refreshWatchers();
    return {
      ...result,
      reason,
      warnings: [...sourceWarnings, ...result.warnings],
    };
  }

  private emptySummary(
    reason: MonitorSyncReason | "rebuild",
    warnings: readonly string[],
  ): MonitorSyncSummary {
    return {
      reason,
      rebuilt: false,
      lastSyncAt: this.now(),
      filesRead: 0,
      linesRead: 0,
      recordsProcessed: 0,
      badLines: 0,
      partialLines: 0,
      unknownVersions: {},
      warnings,
    };
  }

  private refreshWatchers(): void {
    const source = this.resolveSourceRoot().root;
    const desired = new Set<string>();
    if (source !== null) {
      for (const file of listOfficialLedgerFiles(source)) desired.add(dirname(file.absPath));
      // 尚无账本文件时先监视来源根；兜底会发现后续账本并挂上具体目录。
      if (desired.size === 0) desired.add(source);
    }

    for (const [dir, watcher] of this.watchers) {
      if (desired.has(dir)) continue;
      try {
        watcher.close();
      } catch {
        // watcher 已失效。
      }
      this.watchers.delete(dir);
    }

    for (const dir of desired) {
      if (this.watchers.has(dir)) continue;
      try {
        const watcher = watchFs(dir, { persistent: true }, () => {
          void this.requestSync("watch").catch((error) => {
            console.error("Monitor watch sync failed:", error);
          });
        });
        watcher.on("error", (error) => {
          console.error(`Monitor watcher failed for ${dir}:`, error);
          try {
            watcher.close();
          } catch {
            // watcher 已失效。
          }
          this.watchers.delete(dir);
        });
        this.watchers.set(dir, watcher);
      } catch (error) {
        console.warn(`Unable to watch monitor directory ${dir}:`, error);
      }
    }
  }
}
