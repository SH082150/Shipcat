/**
 * 用量服务：Layer 1 → Layer 2 的唯一编排者。
 *
 * - ClockService 按 config 的对齐边界触发；手动同步随时可用；
 * - 同一时刻只跑一轮，时钟与手动重叠时复用同一轮；
 * - 时钟触发距上一轮结束不足 15 秒则跳过（死区，防抖动）；
 * - 不补跑、不重试、不猜测漏掉的数据；手动同步是唯一补救。
 */

import { rmSync } from "node:fs";
import { join } from "node:path";

import { loadUsageConfig, saveUsageConfig, SYNC_INTERVAL_CHOICES } from "./config.ts";
import type { UsageConfig } from "./config.ts";
import { UsageClock } from "./clock.ts";
import { createScanStats } from "./ledger.ts";
import type { LedgerScanStats } from "./ledger.ts";
import { layer1Root, tpdDir } from "./layer1/paths.ts";
import { LEVELS } from "./time.ts";
import type { Layer1Level } from "./time.ts";
import { syncLevel, syncTpd } from "./layer1/sync.ts";
import { TPD_RANGES } from "./layer1/types.ts";
import { buildLayer2 } from "./layer2/build.ts";
import { buildUsageView } from "./layer2/query.ts";
import type { UsageViewDto, UsageViewQuery } from "./layer2/types.ts";

export type UsageSyncReason = "startup" | "manual" | "clock" | "reload";

export interface UsageSyncSummary {
  readonly reason: UsageSyncReason;
  readonly skipped: boolean;
  readonly lastSyncAt: number;
  readonly rebuiltLevels: readonly Layer1Level[];
  readonly eventsProcessed: number;
  readonly filesRead: number;
  readonly badLines: number;
  readonly partialLines: number;
  readonly unknownVersions: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
}

export interface UsageSourceResolution {
  /** 官方账本根；null = 没有启用的来源。 */
  readonly root: string | null;
  /** 来源配置层面的告警（例如启用了多个来源）。 */
  readonly warnings?: readonly string[];
}

export interface UsageServiceOptions {
  /** 自建文件库根：<root>/config.json、layer1、layer2。 */
  readonly usageRoot: string;
  /** 每次同步时解析官方账本根；单账号，只取一个。 */
  readonly sourceRoot: () => UsageSourceResolution;
  readonly now?: () => number;
  /** 时钟查询间隔；缺省 1 秒。 */
  readonly tickMs?: number;
  /** 测试可关闭常驻时钟。 */
  readonly clock?: boolean;
}

const CLOCK_DEAD_ZONE_MS = 15_000;

export class UsageService {
  private readonly root: string;
  private readonly resolveSourceRoot: () => UsageSourceResolution;
  private readonly now: () => number;
  private readonly clockEnabled: boolean;
  private readonly listeners = new Set<(revision: number) => void>();
  private readonly clock: UsageClock;

  private config: UsageConfig;
  private lastTimezone: string | null = null;
  private pendingRebuild = false;
  private revision = 0;
  private running: Promise<UsageSyncSummary> | null = null;
  private lastFinishedAt = 0;
  private lastSummary: UsageSyncSummary | null = null;
  private lastWarnings: readonly string[] = [];
  private disposed = false;

  constructor(options: UsageServiceOptions) {
    this.root = options.usageRoot;
    this.resolveSourceRoot = options.sourceRoot;
    this.now = options.now ?? (() => Date.now());
    this.clockEnabled = options.clock !== false;
    this.config = loadUsageConfig(this.root);
    this.clock = new UsageClock({
      intervalMinutes: this.config.syncIntervalMinutes,
      onBoundary: () => {
        void this.syncNow("clock").catch((error) => {
          console.error("Usage clock sync failed:", error);
        });
      },
      now: this.now,
      tickMs: options.tickMs ?? 1000,
    });
  }

  /** 启动：先跑一轮 startup，再开常驻时钟。 */
  async start(): Promise<UsageSyncSummary> {
    if (this.disposed) throw new Error("UsageService is disposed");
    if (this.clockEnabled) this.clock.start();
    return this.syncNow("startup");
  }

  /**
   * 触发一轮同步。并发调用共享同一轮；时钟触发受 15 秒死区约束。
   */
  syncNow(reason: UsageSyncReason): Promise<UsageSyncSummary> {
    if (this.disposed) return Promise.reject(new Error("UsageService is disposed"));
    if (this.running !== null) return this.running;
    if (reason === "clock" && this.now() - this.lastFinishedAt < CLOCK_DEAD_ZONE_MS) {
      return Promise.resolve(
        this.lastSummary ?? emptySummary(reason, this.now(), ["同步间隔过短，本轮跳过。"]),
      );
    }
    const run = this.runSync(reason).finally(() => {
      this.running = null;
      this.lastFinishedAt = this.now();
    });
    this.running = run;
    return run;
  }

  getView(query: UsageViewQuery): UsageViewDto {
    return {
      ...buildUsageView({
        root: this.root,
        timezone: this.config.timezone,
        now: this.now(),
        revision: this.revision,
        query,
      }),
      warnings: this.lastWarnings,
    };
  }

  getConfig(): UsageConfig {
    return this.config;
  }

  /** 保存配置；时区变化会在下一轮触发全量重建，频率变化立即对齐时钟。 */
  updateConfig(value: unknown): UsageConfig {
    const previous = this.config;
    this.config = saveUsageConfig(this.root, value);
    if (this.lastTimezone !== null && this.lastTimezone !== this.config.timezone) {
      this.pendingRebuild = true;
    }
    if (previous.syncIntervalMinutes !== this.config.syncIntervalMinutes) {
      this.clock.setIntervalMinutes(this.config.syncIntervalMinutes);
    }
    return this.config;
  }

  onChanged(listener: (revision: number) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  reloadSource(): Promise<UsageSyncSummary> {
    return this.syncNow("reload");
  }

  dispose(): void {
    this.disposed = true;
    this.clock.stop();
    this.listeners.clear();
  }

  private async runSync(reason: UsageSyncReason): Promise<UsageSyncSummary> {
    const startedAt = this.now();
    this.config = loadUsageConfig(this.root);
    if (this.lastTimezone === null) this.lastTimezone = this.config.timezone;
    if (this.lastTimezone !== this.config.timezone) {
      this.lastTimezone = this.config.timezone;
      this.pendingRebuild = true;
    }
    this.clock.setIntervalMinutes(this.config.syncIntervalMinutes);

    const resolved = this.resolveSourceRoot();
    const sourceRoot = resolved.root;
    const sourceWarnings = resolved.warnings ?? [];
    if (sourceRoot === null) {
      const summary = emptySummary(reason, startedAt, [
        ...sourceWarnings,
        "未配置启用的用量来源，已跳过同步。",
      ]);
      this.lastSummary = summary;
      this.lastWarnings = summary.warnings;
      return summary;
    }

    if (this.pendingRebuild) {
      for (const level of LEVELS) rmSync(join(layer1Root(this.root), level), { recursive: true, force: true });
      for (const range of TPD_RANGES) rmSync(tpdDir(this.root, range), { recursive: true, force: true });
      this.pendingRebuild = false;
    }

    const stats: LedgerScanStats = createScanStats();
    const rebuiltLevels: Layer1Level[] = [];
    let eventsProcessed = 0;

    for (const level of LEVELS) {
      const result = syncLevel({
        root: this.root,
        sourceRoot,
        level,
        timezone: this.config.timezone,
        now: startedAt,
        stats,
      });
      eventsProcessed += result.eventsProcessed;
      if (result.action === "rebuilt") rebuiltLevels.push(level);
    }
    for (const range of TPD_RANGES) {
      syncTpd({
        root: this.root,
        sourceRoot,
        range,
        timezone: this.config.timezone,
        now: startedAt,
        stats,
      });
    }

    const buildNow = this.now();
    for (const level of LEVELS) {
      buildLayer2({
        root: this.root,
        level,
        timezone: this.config.timezone,
        now: buildNow,
      });
    }

    const warnings: string[] = [...sourceWarnings];
    for (const [version, count] of Object.entries(stats.unknownVersions).sort()) {
      warnings.push(`发现未知账本版本 v=${version}（${count} 行已跳过）`);
    }

    const summary: UsageSyncSummary = {
      reason,
      skipped: false,
      lastSyncAt: buildNow,
      rebuiltLevels,
      eventsProcessed,
      filesRead: stats.filesRead,
      badLines: stats.badLines,
      partialLines: stats.partialLines,
      unknownVersions: stats.unknownVersions,
      warnings,
    };
    this.lastSummary = summary;
    this.lastWarnings = warnings;
    this.revision += 1;
    for (const listener of this.listeners) {
      try {
        listener(this.revision);
      } catch (error) {
        console.error("Usage change listener failed:", error);
      }
    }
    return summary;
  }
}

function emptySummary(
  reason: UsageSyncReason,
  at: number,
  warnings: readonly string[],
): UsageSyncSummary {
  return {
    reason,
    skipped: true,
    lastSyncAt: at,
    rebuiltLevels: [],
    eventsProcessed: 0,
    filesRead: 0,
    badLines: 0,
    partialLines: 0,
    unknownVersions: {},
    warnings,
  };
}

/** 设置页同步频率选项。 */
export { SYNC_INTERVAL_CHOICES };
