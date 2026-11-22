/**
 * 用量入库服务：启动全量对账 + fs.watch 实时探测 + 防抖串行队列 + 低频兜底。
 *
 * 监听器只在文件事务提交成功后收到新的 usage_revision；watcher 回调只记录
 * 受影响路径，不做解析和写库。
 */

import { existsSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { basename, dirname, join } from "node:path";

import { openDatabase } from "../../persistence/index.ts";
import type { Database } from "../../persistence/types.ts";
import { resolveHome } from "../../platform/index.ts";
import type { PlatformOptions } from "../../platform/index.ts";
import { loadSettings } from "../../settings/index.ts";
import type { Settings } from "../../settings/index.ts";
import { listSourceFiles, listWatchDirectories, sourceRoot } from "./source.ts";
import { getRevision, markSource, upsertSource } from "./store.ts";
import { syncFile } from "./sync.ts";
import type {
  FileOutcome,
  SyncReason,
  SyncSummary,
} from "./types.ts";

export interface UsageIngestServiceOptions {
  /** 用户主目录；缺省 resolveHome()。 */
  readonly home?: string;
  readonly platform?: PlatformOptions;
  /** 直接注入配置（测试用）；缺省从 settings.json 读取。 */
  readonly settings?: Settings;
  /** 是否安装 fs.watch；缺省 true。 */
  readonly watch?: boolean;
  /** 兜底对账间隔（毫秒）；0 关闭，缺省 10 分钟。 */
  readonly intervalMs?: number;
  /** watcher 防抖窗口；缺省 300ms。 */
  readonly debounceMs?: number;
  /** 注入“现在”，便于测试。 */
  readonly now?: () => Date;
}

interface PendingWork {
  readonly full: boolean;
  readonly sources: ReadonlySet<string>;
  readonly files: ReadonlySet<string>;
}

interface MutablePending {
  full: boolean;
  sources: Set<string>;
  files: Set<string>;
}

const DEFAULT_INTERVAL_MS = 10 * 60_000;
const DEFAULT_DEBOUNCE_MS = 300;

export class UsageIngestService {
  private readonly home: string;
  private readonly platform: PlatformOptions | undefined;
  private readonly now: () => Date;
  private readonly watchEnabled: boolean;
  private readonly intervalMs: number;
  private readonly debounceMs: number;
  private readonly injectedSettings: Settings | undefined;

  private settings: Settings;
  private readonly db: Database;
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly listeners = new Set<(revision: number) => void>();
  private intervalTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pending: MutablePending = { full: true, sources: new Set(), files: new Set() };
  private queue: Promise<unknown> = Promise.resolve();
  private started = false;
  private disposed = false;
  private lastNotified = -1;

  constructor(options: UsageIngestServiceOptions = {}) {
    this.home = options.home ?? resolveHome();
    this.platform = options.platform;
    this.now = options.now ?? (() => new Date());
    this.watchEnabled = options.watch !== false;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.injectedSettings = options.settings;
    this.settings = options.settings ?? loadSettings(this.home, this.platform);
    this.db = openDatabase({ home: this.home, platform: this.platform });
  }

  /** 启动：先挂 watcher，再做一次全量对账，最后开兜底定时器。 */
  async start(): Promise<SyncSummary> {
    this.ensureUsable();
    if (!this.started) {
      this.started = true;
      if (this.watchEnabled) this.syncWatchers();
    }
    const summary = await this.syncNow("startup");
    if (this.intervalMs > 0 && this.intervalTimer === null) {
      this.intervalTimer = setInterval(() => {
        this.pending.full = true;
        void this.syncNow("interval").catch((error) => {
          console.error("Usage interval sync failed:", error);
        });
      }, this.intervalMs);
      this.intervalTimer.unref?.();
    }
    return summary;
  }

  /** 串行执行一轮同步；watcher 预先收集的受影响路径会在此消费。 */
  syncNow(reason: SyncReason = "manual"): Promise<SyncSummary> {
    if (this.disposed) return Promise.reject(new Error("UsageIngestService is disposed"));
    const run = this.queue.then(
      () => this.runSync(reason),
      () => this.runSync(reason),
    );
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * 仅读：把内部数据库句柄交给查询层。调用方不得在这个句柄上写库；
   * 写入统一由本服务的 syncNow 负责。
   */
  withDatabase<T>(fn: (db: Database) => T): T {
    this.ensureUsable();
    return fn(this.db);
  }

  /** 订阅 revision 变化；返回取消订阅函数。 */
  onChanged(listener: (revision: number) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 重新读取 settings、重建 watcher 并做一次全量对账。 */
  async reloadSources(): Promise<SyncSummary> {
    this.ensureUsable();
    this.settings =
      this.injectedSettings ?? loadSettings(this.home, this.platform);
    this.pending = { full: true, sources: new Set(), files: new Set() };
    if (this.started && this.watchEnabled) this.syncWatchers();
    return this.syncNow("reload");
  }

  /** 停止 watcher/定时器并关闭数据库。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.intervalTimer !== null) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    for (const watcher of this.watchers.values()) {
      try {
        watcher.close();
      } catch {
        // watcher 已失效时忽略。
      }
    }
    this.watchers.clear();
    this.listeners.clear();
    try {
      this.db.close();
    } catch (error) {
      console.error("Failed to close usage database:", error);
    }
  }

  private ensureUsable(): void {
    if (this.disposed) throw new Error("UsageIngestService is disposed");
  }

  private async runSync(reason: SyncReason): Promise<SyncSummary> {
    this.ensureUsable();
    const pending = this.takePending();
    const filtered =
      !pending.full && (pending.sources.size > 0 || pending.files.size > 0);
    const now = this.now();
    const nowIso = now.toISOString();
    const warnings = new Set<string>();
    const unknownVersions: Record<string, number> = {};

    let filesScanned = 0;
    let filesNew = 0;
    let filesAppended = 0;
    let filesRewritten = 0;
    let filesUnchanged = 0;
    let filesSkipped = 0;
    let linesAdded = 0;
    let eventsAdded = 0;
    let eventsReused = 0;
    let mappingsAdded = 0;
    let metricsWritten = 0;

    for (const source of this.settings.usage.sources) {
      const root = sourceRoot(source, this.home, this.platform);
      upsertSource(this.db, source, root);
      if (!source.enabled) {
        markSource(this.db, source.id, nowIso, null);
        continue;
      }
      let sourceError: string | null = null;

      try {
        const discovered = listSourceFiles(source, this.home, this.platform);
        filesScanned += discovered.files.length;
        const selected =
          filtered && !pending.sources.has(source.id)
            ? discovered.files.filter((file) => pending.files.has(file.absPath))
            : discovered.files;

        for (const file of selected) {
          try {
            const outcome = syncFile({
              db: this.db,
              sourceId: source.id,
              file,
              now,
              onCommitted: (revision) => this.notify(revision),
            });
            const counts = countOutcome(outcome);
            filesNew += counts.new;
            filesAppended += counts.appended;
            filesRewritten += counts.rewritten;
            filesUnchanged += counts.unchanged;
            filesSkipped += counts.skipped;
            linesAdded += outcome.linesAdded;
            eventsAdded += outcome.eventsAdded;
            eventsReused += outcome.eventsReused;
            mappingsAdded += outcome.mappingsAdded;
            metricsWritten += outcome.metricsWritten;
            for (const warning of outcome.warnings) warnings.add(warning);
            for (const [version, count] of Object.entries(outcome.unknownVersions)) {
              unknownVersions[version] = (unknownVersions[version] ?? 0) + count;
            }
            if (outcome.action === "skipped" && outcome.warnings[0] !== undefined) {
              sourceError = outcome.warnings[0];
            }
          } catch (error) {
            filesSkipped += 1;
            const message = `文件 ${file.sourceRel} 同步失败：${messageOf(error)}`;
            warnings.add(message);
            sourceError = message;
          }
        }
      } catch (error) {
        filesSkipped += 1;
        const message = `来源 ${source.id} 同步失败：${messageOf(error)}`;
        warnings.add(message);
        sourceError = message;
      }

      markSource(this.db, source.id, nowIso, sourceError);
    }

    for (const [version, count] of Object.entries(unknownVersions).sort()) {
      warnings.add(`发现未知账本版本 v=${version}（${count} 行已入库）`);
    }

    if (this.started && this.watchEnabled) this.syncWatchers();

    return {
      reason,
      revision: getRevision(this.db),
      filesScanned,
      filesNew,
      filesAppended,
      filesRewritten,
      filesUnchanged,
      filesSkipped,
      linesAdded,
      eventsAdded,
      eventsReused,
      mappingsAdded,
      metricsWritten,
      warnings: [...warnings],
      unknownVersionsSeen: unknownVersions,
      lastSyncAt: nowIso,
    };
  }

  private takePending(): PendingWork {
    const pending = this.pending;
    this.pending = { full: false, sources: new Set(), files: new Set() };
    return pending;
  }

  private notify(revision: number): void {
    if (revision === this.lastNotified) return;
    this.lastNotified = revision;
    for (const listener of this.listeners) {
      try {
        listener(revision);
      } catch (error) {
        console.error("Usage change listener failed:", error);
      }
    }
  }

  private desiredWatchDirs(): Map<string, Set<string>> {
    const desired = new Map<string, Set<string>>();
    if (!this.watchEnabled) return desired;
    for (const source of this.settings.usage.sources) {
      if (!source.enabled) continue;
      const root = sourceRoot(source, this.home, this.platform);
      const dirs = listWatchDirectories(root);
      const targets = dirs.length > 0 ? dirs : [nearestExisting(root)].filter(isString);
      for (const dir of targets) {
        const ids = desired.get(dir) ?? new Set<string>();
        ids.add(source.id);
        desired.set(dir, ids);
      }
    }
    return desired;
  }

  private syncWatchers(): void {
    if (this.disposed) return;
    const desired = this.desiredWatchDirs();
    for (const [dir, watcher] of this.watchers) {
      if (desired.has(dir)) continue;
      try {
        watcher.close();
      } catch {
        // 已失效。
      }
      this.watchers.delete(dir);
    }
    for (const [dir, sourceIds] of desired) {
      if (this.watchers.has(dir)) continue;
      this.watchDirectory(dir, sourceIds);
    }
  }

  private watchDirectory(dir: string, sourceIds: ReadonlySet<string>): void {
    try {
      const watcher = watch(dir, { persistent: true }, (_event, filename) => {
        const name = filename === null ? null : String(filename);
        for (const sourceId of sourceIds) this.handleWatchEvent(sourceId, dir, name);
      });
      watcher.on("error", (error) => {
        console.error(`Usage watcher failed for ${dir}:`, error);
        try {
          watcher.close();
        } catch {
          // 已失效。
        }
        this.watchers.delete(dir);
      });
      this.watchers.set(dir, watcher);
    } catch (error) {
      console.warn(`Unable to watch usage directory ${dir}:`, error);
    }
  }

  private handleWatchEvent(
    sourceId: string,
    dir: string,
    filename: string | null,
  ): void {
    const isLedgerDir = basename(dir) === "usage-ledger";
    if (isLedgerDir && filename !== null && filename.endsWith(".ndjson")) {
      this.pending.files.add(join(dir, filename));
    } else {
      this.pending.sources.add(sourceId);
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (!this.started || this.disposed || this.debounceTimer !== null) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.disposed) return;
      this.syncWatchers();
      void this.syncNow("watch").catch((error) => {
        console.error("Usage watch sync failed:", error);
      });
    }, this.debounceMs);
    this.debounceTimer.unref?.();
  }
}

function countOutcome(outcome: FileOutcome): {
  new: number;
  appended: number;
  rewritten: number;
  unchanged: number;
  skipped: number;
} {
  return {
    new: outcome.action === "new" ? 1 : 0,
    appended: outcome.action === "appended" ? 1 : 0,
    rewritten: outcome.action === "rewritten" ? 1 : 0,
    unchanged: outcome.action === "unchanged" ? 1 : 0,
    skipped: outcome.action === "skipped" ? 1 : 0,
  };
}

function nearestExisting(path: string): string | null {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
