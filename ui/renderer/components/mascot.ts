/**
 * 欢迎页小猫：小时级换品种 + 点击触发动作。
 *
 * 品种与动作都由哈希/概率决定，同一小时内刷新页面结果不变。
 */

export type MascotAction = "blink" | "tail";

export interface MascotClip {
  /** 素材标识，例如 "cat-4-blink"。 */
  readonly id: string;
  readonly cat: number;
  readonly action: MascotAction;
  /** 这一动作占用的时长，等于 GIF 一个循环的长度。 */
  readonly durationMs: number;
}

/** 每只猫的出场权重。 */
export const CAT_WEIGHTS: Readonly<Record<number, number>> = {
  4: 88,
  1: 3,
  2: 3,
  5: 3,
  6: 3,
};

/**
 * 动作时长，等于 GIF 自身一个循环：
 * cat_x_blink.gif = 1600+80+120+80 = 1880ms；
 * cat_x_tail.gif  = 8 帧 × 90ms = 720ms。
 * 重新导出 GIF 改了帧率时，请同步这两个数。
 */
export const ACTION_DURATIONS: Readonly<Record<MascotAction, number>> = {
  blink: 1_880,
  tail: 720,
};

/** 点击后触发动作的概率；剩下的概率就是「不理你」。 */
export const CLICK_REACTION_CHANCE = 0.5;

const HOUR_MS = 60 * 60 * 1000;

/** 把任意整数打散成 [0,1) 的伪随机数。 */
function hashUnit(value: number): number {
  let h = value ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h ^ (h >>> 16), 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function pickWeighted<T>(entries: readonly (readonly [T, number])[], roll: number): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let value = roll * total;
  for (const [item, weight] of entries) {
    if (value < weight) return item;
    value -= weight;
  }
  return entries[entries.length - 1]![0];
}

/** 当前这一小时展示哪只猫；同一小时内结果稳定。 */
export function catForTime(now: number = Date.now()): number {
  const hour = Math.floor(now / HOUR_MS);
  const entries = Object.entries(CAT_WEIGHTS).map(
    ([key, weight]) => [Number(key), weight] as const,
  );
  return pickWeighted(entries, hashUnit(hour));
}

/** 距离下一个整点还有多少毫秒（加 1 秒余量，避免边界抖动）。 */
export function msUntilNextHour(now: number = Date.now()): number {
  return HOUR_MS - (now % HOUR_MS) + 1_000;
}

export function clipId(cat: number, action: MascotAction): string {
  return `cat-${cat}-${action}`;
}

export function makeClip(cat: number, action: MascotAction): MascotClip {
  return { id: clipId(cat, action), cat, action, durationMs: ACTION_DURATIONS[action] };
}

/** 动图素材。 */
export function mascotSource(clip: MascotClip): string {
  return `./assets/mascots/${clip.id}.gif`;
}

/** 静态素材：默认状态与「减少动态效果」都用它。 */
export function mascotStillSource(cat: number): string {
  return `./assets/mascots/cat-${cat}.png`;
}

export function pickClickAction(rand: () => number = Math.random): MascotAction | null {
  if (rand() >= CLICK_REACTION_CHANCE) return null;
  return rand() < 0.5 ? "blink" : "tail";
}
