/**
 * 本地时区时间工具：桶边界、本地日、格式化。
 *
 * 时间戳始终是 UTC epoch 毫秒；所有桶边界按 IANA 时区（config.timezone）
 * 的本地墙钟计算，不依赖运行环境时区。30m / 1h 用「ts + 偏移」对齐到
 * 固定长度；1d 按日历日，DST 日可能是 23/25 小时，不能固定减 86_400_000。
 */

export type Layer1Level = "30m" | "1h" | "1d";

export const LEVELS: readonly Layer1Level[] = ["30m", "1h", "1d"];

export const LEVEL_STEP_MS: Readonly<Record<Layer1Level, number>> = {
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

export interface LocalParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** 时区名是否被运行环境接受。 */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.trim().length === 0) return false;
  try {
    formatterFor(timeZone).format(0);
    return true;
  } catch {
    return false;
  }
}

/** 当前机器的 IANA 时区；取不到时回落 UTC。 */
export function systemTimeZone(): string {
  try {
    const resolved = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return resolved.length > 0 ? resolved : "UTC";
  } catch {
    return "UTC";
  }
}

/** ts 在指定时区下的墙钟字段。 */
export function localParts(ts: number, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(ts));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found === undefined ? 0 : Number(found.value);
  };
  const hour = read("hour");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // 个别 ICU 版本在 h23 下仍返回 24；归一到 0。
    hour: hour === 24 ? 0 : hour,
    minute: read("minute"),
    second: read("second"),
  };
}

function partsToUtc(parts: LocalParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

/** ts 所在时区相对 UTC 的偏移（毫秒，东正西负）。 */
export function zoneOffsetMs(ts: number, timeZone: string): number {
  const whole = Math.floor(ts / 1000) * 1000;
  return partsToUtc(localParts(whole, timeZone)) - whole;
}

/** 指定时区墙钟 → UTC epoch 毫秒；对 DST 边界做两次偏移校正。 */
export function zonedEpochMs(parts: LocalParts, timeZone: string): number {
  const guess = partsToUtc(parts);
  const firstOffset = zoneOffsetMs(guess, timeZone);
  let epoch = guess - firstOffset;
  const secondOffset = zoneOffsetMs(epoch, timeZone);
  if (secondOffset !== firstOffset) epoch = guess - secondOffset;
  return epoch;
}

/** 本地日历日零点。 */
export function localDayStart(ts: number, timeZone: string): number {
  const parts = localParts(ts, timeZone);
  return zonedEpochMs({ ...parts, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** 本地日历日按自然日加减；DST 日长度可变。 */
export function addLocalDays(dayStartTs: number, days: number, timeZone: string): number {
  const parts = localParts(dayStartTs, timeZone);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return zonedEpochMs(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone,
  );
}

/**
 * ts 所属桶的起点。
 *
 * 30m / 1h 用「ts + 当前偏移」对固定长度取整，能区分 DST 回拨时重复的
 * 本地小时；1d 用本地日历日零点。
 */
export function localBucketStart(ts: number, level: Layer1Level, timeZone: string): number {
  if (level === "1d") return localDayStart(ts, timeZone);
  const step = LEVEL_STEP_MS[level];
  const wall = ts + zoneOffsetMs(ts, timeZone);
  const remainder = ((wall % step) + step) % step;
  return ts - remainder;
}

/**
 * 当前窗口的桶起点数组，索引 0 = 最新，索引 count-1 = 最老。
 * 30m / 1h 直接按固定长度回退；1d 按日历日回退。
 */
export function windowStarts(
  level: Layer1Level,
  now: number,
  timeZone: string,
  count = 336,
): number[] {
  const newest = localBucketStart(now, level, timeZone);
  if (level === "1d") {
    const out: number[] = [];
    let cursor = newest;
    for (let index = 0; index < count; index += 1) {
      out.push(cursor);
      cursor = addLocalDays(cursor, -1, timeZone);
    }
    return out;
  }
  const step = LEVEL_STEP_MS[level];
  return Array.from({ length: count }, (_, index) => newest - index * step);
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** 本地日期 YYYY-MM-DD。 */
export function formatLocalDay(ts: number, timeZone: string): string {
  const parts = localParts(ts, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** 本地时间 YYYY-MM-DD HH:mm。 */
export function formatLocalMinute(ts: number, timeZone: string): string {
  const parts = localParts(ts, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** 本地时间 YYYY-MM-DD HH:mm:ss。 */
export function formatLocalSecond(ts: number, timeZone: string): string {
  const parts = localParts(ts, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

/** 桶的展示文案：30m / 1h = 本地分钟，1d = 本地日期。 */
export function formatBucketStart(
  ts: number,
  level: Layer1Level,
  timeZone: string,
): string {
  return level === "1d" ? formatLocalDay(ts, timeZone) : formatLocalMinute(ts, timeZone);
}
