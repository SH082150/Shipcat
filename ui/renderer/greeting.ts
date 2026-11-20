/**
 * 概览问候语：每 5 分钟换一次，按类别加权随机。
 *
 * 动作和声音分成两类，不会在同一句里拼在一起；两类权重独立。
 * 只有时间、普通、节日三类会称呼用户名（属于对用户说话）；
 * 天气、星期、周末、小猫两类写成自言自语，不带用户名。
 *
 * 选择使用 5 分钟时间槽做确定性随机，避免每次重渲染都跳变；
 * 连续命中同一类时顺延到下一类。
 */

export type GreetingWeatherKind =
  | "clear"
  | "cloudy"
  | "rain"
  | "heavy-rain"
  | "drizzle"
  | "snow"
  | "fog"
  | "wind";

export interface GreetingWeather {
  readonly kind: GreetingWeatherKind;
  readonly temperature?: number;
}

export interface GreetingInput {
  readonly language: "zh" | "en";
  readonly username?: string;
  readonly now?: Date;
  readonly weather?: GreetingWeather | null;
}

function nameOf(username: string | undefined, language: "zh" | "en"): string {
  const value = username?.trim();
  if (value) return value;
  return language === "zh" ? "朋友" : "friend";
}

function timeGreetings(hour: number, name: string, language: "zh" | "en"): string[] {
  if (language === "en") {
    if (hour < 5) return [`It's ${hour}:00, ${name}.`, `Still awake, ${name}?`];
    if (hour < 9) return [`Good morning, ${name}.`, `Morning, ${name}.`, `Breakfast yet, ${name}?`];
    if (hour < 12) return [`Good morning, ${name}.`, `What's on today, ${name}?`];
    if (hour < 14) return [`Good noon, ${name}.`, `Lunch yet, ${name}?`];
    if (hour < 18) return [`Good afternoon, ${name}.`, `How's the day going, ${name}?`];
    if (hour < 23) return [`Good evening, ${name}.`, `Starting work, ${name}?`];
    return [`It's getting late, ${name}.`, `Still up, ${name}?`];
  }
  if (hour < 5) return [`已经凌晨 ${hour} 点了，${name}。`, `还没睡吗，${name}？`];
  if (hour < 9) return [`天快亮了，${name}。`, `早上好，${name}。`, `吃早饭了吗，${name}！`];
  if (hour < 12) return [`上午好，${name}。`, `今天忙点什么，${name}？`];
  if (hour < 14) return [`中午好，${name}。`, `吃午饭了吗，${name}！`];
  if (hour < 18) return [`下午好，${name}。`, `今天怎么样，${name}？`];
  if (hour < 23) return [`晚上好，${name}。`, `开始工作啦，${name}？`];
  return [`夜深了，${name}。`, `还没睡吗，${name}？`];
}

function generalGreetings(name: string, language: "zh" | "en"): string[] {
  return language === "en"
    ? [
        `You're here, ${name}!`,
        `Long time no see, ${name}!`,
        `How are you today, ${name}?`,
        `What are you working on, ${name}?`,
        `What's on your mind, ${name}?`,
        `Shall we start, ${name}?`,
        `Welcome back, ${name}.`,
      ]
    : [
        `你来了，${name}！`,
        `好久不见，${name}！`,
        `今天状态怎么样，${name}？`,
        `有什么想做的事吗，${name}？`,
        `在想什么呢，${name}？`,
        `要不要先喝口水，${name}。`,
        `欢迎回来，${name}。`,
      ];
}

function weatherGreetings(kind: GreetingWeatherKind, language: "zh" | "en"): string[] {
  const zh: Record<GreetingWeatherKind, string[]> = {
    clear: [`外面天晴了。`, `今天阳光不错。`],
    cloudy: [`外边是阴天。`, `天有点阴沉。`],
    rain: [`开始下雨了。`, `外面在下雨。`],
    "heavy-rain": [`雨下大了。`, `外面雨很大。`],
    drizzle: [`雨快停了。`, `外面飘着小雨。`],
    snow: [`下雪了。`, `外面在下雪。`],
    fog: [`什么都看不见了。`, `外面起雾了。`],
    wind: [`刮风了。`, `外面风有点大。`],
  };
  const en: Record<GreetingWeatherKind, string[]> = {
    clear: [`It's clear outside.`, `Nice sunshine today.`],
    cloudy: [`It's cloudy outside.`, `A grey sky today.`],
    rain: [`It's raining.`, `Rain outside.`],
    "heavy-rain": [`It's pouring.`, `Heavy rain outside.`],
    drizzle: [`The rain is easing.`, `A little drizzle.`],
    snow: [`It's snowing.`, `Snow outside.`],
    fog: [`It's foggy.`, `Can't see far in this fog.`],
    wind: [`It's windy.`, `Windy outside.`],
  };
  return (language === "zh" ? zh : en)[kind];
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type GreetingCategory =
  | "time"
  | "general"
  | "weather"
  | "weekday"
  | "weekend"
  | "holiday"
  | "cat"
  | "meow";

interface Candidate {
  readonly category: GreetingCategory;
  readonly weight: number;
  readonly phrases: readonly string[];
}

let lastCategory: GreetingCategory | null = null;

const WEEKDAY_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEKDAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekdayGreetings(day: number, language: "zh" | "en"): string[] {
  if (language === "en") {
    if (day === 1) return [`A new week.`, `Monday again.`, `Fresh start.`];
    if (day === 3) return [`Halfway through the week.`, `${WEEKDAY_EN[day]} already.`];
    if (day === 5) return [`It's Friday!`, `Almost the weekend.`, `Last push.`];
    return [`${WEEKDAY_EN[day]}.`, `Easing into it.`];
  }
  if (day === 1) return [`新的一周。`, `周一，加油。`, `周一了，慢慢来。`];
  if (day === 3) return [`周三了。`, `一周过半。`];
  if (day === 5) return [`周五了！`, `快周末了。`, `再撑一下。`];
  return [`${WEEKDAY_ZH[day]}。`, `${WEEKDAY_ZH[day]}了，节奏稳住。`];
}

function weekendGreetings(language: "zh" | "en"): string[] {
  return language === "en"
    ? [
        `Weekend already.`,
        `Taking a break today?`,
        `Still working this weekend?`,
        `A slow weekend.`,
        `No alarms today.`,
      ]
    : [`周末了。`, `今天休息吗？`, `周末还在忙吗？`, `周末慢一点。`, `今天不用赶时间。`];
}

interface Holiday {
  readonly zh: string;
  readonly en: string;
}

const SOLAR_HOLIDAYS: Record<string, Holiday> = {
  "01-01": { zh: "元旦", en: "New Year's Day" },
  "02-14": { zh: "情人节", en: "Valentine's Day" },
  "05-01": { zh: "劳动节", en: "Labour Day" },
  "06-01": { zh: "儿童节", en: "Children's Day" },
  "10-01": { zh: "国庆", en: "National Day" },
  "12-25": { zh: "圣诞", en: "Christmas" },
};

const LUNAR_HOLIDAYS: Record<string, Holiday> = {
  "2026-02-17": { zh: "春节", en: "Lunar New Year" },
  "2027-02-06": { zh: "春节", en: "Lunar New Year" },
  "2028-01-26": { zh: "春节", en: "Lunar New Year" },
  "2029-02-13": { zh: "春节", en: "Lunar New Year" },
  "2030-02-03": { zh: "春节", en: "Lunar New Year" },
  "2026-09-25": { zh: "中秋", en: "Mid-Autumn Festival" },
  "2027-09-15": { zh: "中秋", en: "Mid-Autumn Festival" },
  "2028-10-03": { zh: "中秋", en: "Mid-Autumn Festival" },
  "2029-09-22": { zh: "中秋", en: "Mid-Autumn Festival" },
  "2030-09-12": { zh: "中秋", en: "Mid-Autumn Festival" },
};

function holidayGreetings(now: Date, name: string, language: "zh" | "en"): string[] | null {
  const monthDay = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const fullDate = `${now.getFullYear()}-${monthDay}`;
  const holiday = LUNAR_HOLIDAYS[fullDate] ?? SOLAR_HOLIDAYS[monthDay];
  if (!holiday) return null;
  if (language === "en") {
    if (holiday.en === "New Year's Day") return [`Happy New Year, ${name}!`, `A fresh year, ${name}.`, `New year, new plans, ${name}.`];
    if (holiday.en === "Christmas") return [`Merry Christmas, ${name}.`, `Christmas is here, ${name}.`, `Hope the tree is up, ${name}.`];
    if (holiday.en === "Lunar New Year") return [`Happy Lunar New Year, ${name}!`, `New year, ${name}.`, `May the year treat you well, ${name}.`];
    if (holiday.en === "Mid-Autumn Festival") return [`Happy Mid-Autumn, ${name}.`, `Mooncakes today, ${name}?`];
    return [`Happy ${holiday.en}, ${name}.`, `${holiday.en} today, ${name}.`];
  }
  if (holiday.zh === "元旦") return [`新年快乐，${name}！`, `新的一年，${name}。`, `又是新的一年，${name}。`];
  if (holiday.zh === "春节") return [`春节快乐，${name}！`, `过年好，${name}！`, `新年顺利，${name}。`];
  if (holiday.zh === "中秋") return [`中秋快乐，${name}！`, `吃月饼了吗，${name}？`];
  if (holiday.zh === "国庆") return [`国庆快乐，${name}！`, `放假了，${name}。`];
  return [`${holiday.zh}快乐，${name}！`, `今天是${holiday.zh}，${name}。`];
}

function catActionGreetings(language: "zh" | "en"): string[] {
  return language === "en"
    ? [
        `The kitten is napping by the window.`,
        `The kitten just yawned at you.`,
        `The kitten walked across the keyboard.`,
        `The kitten rolled the yarn ball away.`,
        `Shh, the kitten is sleeping.`,
        `The kitten is staring out the window.`,
        `The kitten is dozing on the corner of the desk.`,
        `The kitten knocked a pen off the desk.`,
        `*licks a paw*`,
        `*tail flick*`,
      ]
    : [
        `小猫在窗边晒太阳。`,
        `小猫打了个哈欠。`,
        `小猫踩到键盘了。`,
        `小猫把毛线球滚远了。`,
        `小猫在睡觉，小声一点。`,
        `小猫盯着窗外发呆。`,
        `小猫在桌角打盹。`,
        `小猫把笔推下桌了。`,
        `（舔爪子）`,
        `（尾巴甩了甩）`,
      ];
}

function catVoiceGreetings(language: "zh" | "en"): string[] {
  return language === "en"
    ? [
        `Meow.`,
        `Meow~`,
        `Mrrp~`,
        `Mrrrp...`,
        `Meow!`,
        `Meow?`,
        `Meow meow meow.`,
        `*purr*`,
        `Zzzz......`,
        `Open a can for me.`,
        `Pet me again.`,
        `The food bowl is empty.`,
        `Can I push this cup off the desk?`,
      ]
    : [
        `喵。`,
        `喵～`,
        `喵呜～`,
        `喵呜……`,
        `喵！`,
        `喵？`,
        `喵喵喵。`,
        `呼噜呼噜。`,
        `Zzzz......`,
        `给我开个罐头吃。`,
        `再摸一下我。`,
        `饭盆空了。`,
        `这个杯子我可以推下去吗？`,
      ];
}

export function pickGreeting(input: GreetingInput): string {
  const language = input.language;
  const now = input.now ?? new Date();
  const name = nameOf(input.username, language);
  const slot = Math.floor(now.getTime() / (5 * 60_000));
  const seed = hash(`${slot}:${name}`);

  const time = timeGreetings(now.getHours(), name, language);
  const general = generalGreetings(name, language);
  const weather = input.weather ? weatherGreetings(input.weather.kind, language) : null;
  const holiday = holidayGreetings(now, name, language);
  const day = now.getDay();
  const weekday = day >= 1 && day <= 5 ? weekdayGreetings(day, language) : null;
  const weekend = day === 0 || day === 6 ? weekendGreetings(language) : null;
  const cat = catActionGreetings(language);
  const meow = catVoiceGreetings(language);

  const candidates: Candidate[] = [
    { category: "time", weight: 30, phrases: time },
    { category: "general", weight: 20, phrases: general },
    ...(weather ? [{ category: "weather" as const, weight: 18, phrases: weather }] : []),
    ...(weekday ? [{ category: "weekday" as const, weight: 10, phrases: weekday }] : []),
    ...(weekend ? [{ category: "weekend" as const, weight: 12, phrases: weekend }] : []),
    ...(holiday ? [{ category: "holiday" as const, weight: 25, phrases: holiday }] : []),
    { category: "cat", weight: 10, phrases: cat },
    { category: "meow", weight: 10, phrases: meow },
  ];

  const total = candidates.reduce((sum, item) => sum + item.weight, 0);
  let roll = seed % total;
  let chosen = candidates[0]!;
  for (const item of candidates) {
    if (roll < item.weight) {
      chosen = item;
      break;
    }
    roll -= item.weight;
  }

  if (chosen.category === lastCategory && candidates.length > 1) {
    const index = candidates.findIndex((item) => item.category === chosen.category);
    chosen = candidates[(index + 1) % candidates.length]!;
  }
  lastCategory = chosen.category;

  return chosen.phrases[(seed >>> 8) % chosen.phrases.length] ?? chosen.phrases[0] ?? "";
}
