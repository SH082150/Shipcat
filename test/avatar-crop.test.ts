import assert from "node:assert/strict";
import test from "node:test";

import { computeCropRect } from "../ui/renderer/settings/avatar-crop.ts";

function assertRect(
  actual: { sx: number; sy: number; sw: number; sh: number },
  expected: { sx: number; sy: number; sw: number; sh: number },
): void {
  for (const key of ["sx", "sy", "sw", "sh"] as const) {
    assert.ok(
      Math.abs(actual[key] - expected[key]) < 1e-6,
      `${key}: 期望 ${expected[key]}，实际 ${actual[key]}`,
    );
  }
}

test("computeCropRect：横图按 cover 居中裁出正方形", () => {
  // 1000×500 铺满 300×300：scale = 0.6，裁剪 500×500，水平居中。
  assertRect(computeCropRect(1000, 500, 1, 0, 0, 300), {
    sx: 250,
    sy: 0,
    sw: 500,
    sh: 500,
  });
});

test("computeCropRect：竖图居中裁剪", () => {
  assertRect(computeCropRect(500, 1000, 1, 0, 0, 300), {
    sx: 0,
    sy: 250,
    sw: 500,
    sh: 500,
  });
});

test("computeCropRect：放大后裁剪尺寸缩小且保持居中", () => {
  // zoom = 2：scale = 1.2，裁剪 250×250，水平与垂直均居中。
  assertRect(computeCropRect(1000, 500, 2, 0, 0, 300), {
    sx: 375,
    sy: 125,
    sw: 250,
    sh: 250,
  });
});

test("computeCropRect：位移超出边界时夹紧在源图内", () => {
  const rect = computeCropRect(1000, 500, 1, -9999, -9999, 300);
  assertRect(rect, { sx: 500, sy: 0, sw: 500, sh: 500 });
  assert.ok(rect.sx + rect.sw <= 1000);
  assert.ok(rect.sy + rect.sh <= 500);

  const opposite = computeCropRect(1000, 500, 1, 9999, 9999, 300);
  assertRect(opposite, { sx: 0, sy: 0, sw: 500, sh: 500 });
});

test("computeCropRect：正方形图 1x 时整图即裁剪区", () => {
  assertRect(computeCropRect(500, 500, 1, 0, 0, 300), {
    sx: 0,
    sy: 0,
    sw: 500,
    sh: 500,
  });
});

test("computeCropRect：无效尺寸返回全 0", () => {
  assertRect(computeCropRect(0, 500, 1, 0, 0, 300), { sx: 0, sy: 0, sw: 0, sh: 0 });
  assertRect(computeCropRect(500, 500, 1, 0, 0, 0), { sx: 0, sy: 0, sw: 0, sh: 0 });
});
