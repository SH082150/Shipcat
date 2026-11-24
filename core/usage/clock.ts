/**
 * 常驻授时循环：每 tick 查询系统时钟，跨过对齐边界就触发一次同步。
 *
 * 不用一次性 setTimeout：机器休眠会错过单次定时器，而常驻循环在唤醒后
 * 读到的系统时间已经跨过边界，自然只触发一次。不补跑、不授权补救。
 */

export interface UsageClockOptions {
  readonly intervalMinutes: number;
  readonly onBoundary: () => void;
  readonly now?: () => number;
  /** 时钟查询间隔；缺省 1 秒。 */
  readonly tickMs?: number;
}

export class UsageClock {
  private readonly onBoundary: () => void;
  private readonly now: () => number;
  private readonly tickMs: number;
  private intervalMs: number;
  private lastKey = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: UsageClockOptions) {
    this.onBoundary = options.onBoundary;
    this.now = options.now ?? (() => Date.now());
    this.tickMs = options.tickMs ?? 1000;
    this.intervalMs = Math.max(1, Math.round(options.intervalMinutes)) * 60_000;
  }

  get intervalMinutes(): number {
    return Math.round(this.intervalMs / 60_000);
  }

  start(): void {
    if (this.timer !== null) return;
    this.lastKey = Math.floor(this.now() / this.intervalMs);
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** 改变频率：不追溯，按新的边界重新对齐。 */
  setIntervalMinutes(minutes: number): void {
    const ms = Math.max(1, Math.round(minutes)) * 60_000;
    if (ms === this.intervalMs) return;
    this.intervalMs = ms;
    this.lastKey = Math.floor(this.now() / this.intervalMs);
  }

  /** 供测试直接推进：跨过边界时触发一次。 */
  tick(): void {
    const key = Math.floor(this.now() / this.intervalMs);
    if (key <= this.lastKey) return;
    this.lastKey = key;
    try {
      this.onBoundary();
    } catch (error) {
      console.error("Usage clock callback failed:", error);
    }
  }
}
