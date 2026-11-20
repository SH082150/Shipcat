/**
 * 这一层是纯逻辑，不碰 DOM。比例断言用统计区间，改权重后分布跑偏会立刻失败。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_DURATIONS,
  CAT_WEIGHTS,
  CLICK_REACTION_CHANCE,
  catForTime,
  makeClip,
  mascotSource,
  mascotStillSource,
  msUntilNextHour,
  pickClickAction,
} from "../ui/renderer/components/mascot.ts";

test("mascot: 品种权重是第 4 只 88%，其余各 3%", () => {
  assert.deepEqual(CAT_WEIGHTS, { 4: 88, 1: 3, 2: 3, 5: 3, 6: 3 });
});

test("mascot: 逐小时取样时分布接近权重，且第 3 只永不出场", () => {
  const counts = new Map<number, number>();
  const hours = 5_000;
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < hours; i += 1) {
    const cat = catForTime(start + i * 3_600_000);
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  assert.equal(counts.get(3), undefined, "第 3 只不应出现在欢迎页");

  const share = (cat: number): number => (counts.get(cat) ?? 0) / hours;
  assert.ok(Math.abs(share(4) - 0.88) < 0.02, `第 4 只应约 88%，实际 ${(share(4) * 100).toFixed(1)}%`);
  for (const cat of [1, 2, 5, 6]) {
    assert.ok(share(cat) > 0, `第 ${cat} 只应能抽到`);
    assert.ok(share(cat) < 0.06, `第 ${cat} 只应低于 6%`);
  }
});

test("mascot: 同一小时结果稳定，跨小时才会变", () => {
  const base = Date.UTC(2026, 10, 21, 6, 0, 0);
  const first = catForTime(base);
  assert.equal(catForTime(base + 1_000), first, "同一小时内重新渲染不应换猫");
  assert.equal(catForTime(base + 59 * 60_000), first);

  // 连续若干小时里应出现多种猫，说明确实在换。
  const cats = new Set<number>();
  for (let i = 0; i < 72; i += 1) cats.add(catForTime(base + i * 3_600_000));
  assert.ok(cats.size >= 3, `72 小时内应换过多种猫，实际 ${cats.size} 种`);
});

test("mascot: 下一次换品种的等待时间落在 0–1 小时之间", () => {
  const base = Date.UTC(2026, 10, 21, 6, 30, 0);
  const wait = msUntilNextHour(base);
  assert.ok(wait > 0 && wait <= 3_600_000);
  assert.ok(Math.abs(wait - (30 * 60_000 + 1_000)) < 1_000);
});

test("mascot: 动作时长等于 GIF 一个循环，素材路径按品种与动作拼", () => {
  assert.deepEqual(ACTION_DURATIONS, { blink: 1_880, tail: 720 });
  const blink = makeClip(4, "blink");
  assert.equal(blink.id, "cat-4-blink");
  assert.equal(blink.durationMs, 1_880);
  assert.equal(mascotSource(blink), "./assets/mascots/cat-4-blink.gif");
  assert.equal(mascotStillSource(4), "./assets/mascots/cat-4.png");
  assert.equal(mascotStillSource(6), "./assets/mascots/cat-6.png");
});

test("mascot: 点击后 50% 没反应，其余按眨眼 / 甩尾对半", () => {
  assert.equal(CLICK_REACTION_CHANCE, 0.5);

  const rounds = 20_000;
  let none = 0;
  let blink = 0;
  let tail = 0;
  for (let i = 0; i < rounds; i += 1) {
    const action = pickClickAction();
    if (action === null) none += 1;
    else if (action === "blink") blink += 1;
    else tail += 1;
  }
  const share = (value: number): number => value / rounds;
  assert.ok(Math.abs(share(none) - 0.5) < 0.03, `没反应应约 50%，实际 ${(share(none) * 100).toFixed(1)}%`);
  assert.ok(Math.abs(share(blink) - 0.25) < 0.03, `眨眼应约 25%，实际 ${(share(blink) * 100).toFixed(1)}%`);
  assert.ok(Math.abs(share(tail) - 0.25) < 0.03, `甩尾应约 25%，实际 ${(share(tail) * 100).toFixed(1)}%`);

  // 固定随机数的边界：0 一定触发眨眼，接近 1 一定没反应。
  assert.equal(pickClickAction(() => 0), "blink");
  assert.equal(pickClickAction(() => 0.99), null);
});
