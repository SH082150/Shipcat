/**
 * 应用图标：把 assets/source/mascots.png（6 只像素小猫的横向拼图）里的第 4 只
 * 做成各尺寸图标。
 *
 * 输入是 8 倍放大的纯色像素画，所以先按背景色抠图、按列聚成 6 只，再还原到
 * 原生像素网格（25×23）后整数放大 —— 只有整数放大才能保证 Dock 里不糊。
 *
 * 产物：
 *   assets/icons/icon-{16,32,64,128,256,512,1024}.png
 *   assets/icons/icon.png（1024 母版，开发态窗口图标用）
 *   assets/icons/icon.ico（Windows）
 *   assets/icons/Shipcat.icns（macOS，iconutil 打包）
 *
 * 注意：欢迎页用的 cat-N.png / cat-N.gif 由 scripts/build-mascots.mjs 生成，
 * 这里只负责应用图标。
 *
 * 换图流程：替换 assets/source/mascots.png → npm run icons
 */

import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  centerOnCanvas,
  createImage,
  crop,
  decodePng,
  encodePng,
  keyOutColor,
  pixelAt,
  scaleNearest,
} from "./lib/png.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "assets", "source", "mascots.png");
const ICON_DIR = join(ROOT, "assets", "icons");

/** 第 4 只作为应用图标。 */
const APP_ICON_INDEX = 3;
const GRID = 8;
const ICON_SIZES = [16, 32, 64, 128, 256, 512, 1024];
/** 猫占画布的比例（留出 macOS 图标的安全边距）。 */
const ICON_FILL = 0.78;
const BACKGROUND_RGB = [245, 243, 240];

/** 按列把拼图拆成 6 只，各自裁到实际像素边界。 */
function splitSprites(image) {
  const opaqueColumn = new Array(image.width).fill(false);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (pixelAt(image, x, y)[3] !== 0) opaqueColumn[x] = true;
    }
  }
  const spans = [];
  let start = -1;
  for (let x = 0; x <= image.width; x += 1) {
    const solid = x < image.width && opaqueColumn[x];
    if (solid && start < 0) start = x;
    else if (!solid && start >= 0) {
      spans.push([start, x - 1]);
      start = -1;
    }
  }
  return spans.map(([x0, x1]) => {
    let y0 = Number.POSITIVE_INFINITY;
    let y1 = -1;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (pixelAt(image, x, y)[3] === 0) continue;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return crop(image, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  });
}

/** 按 8×8 网格还原到原生像素（每格取中心点），保证后续整数放大是干净的。 */
function toNativeGrid(image) {
  if (image.width % GRID !== 0 || image.height % GRID !== 0) return image;
  const w = image.width / GRID;
  const h = image.height / GRID;
  const out = createImage(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      pixelAt(image, x * GRID + GRID / 2, y * GRID + GRID / 2).copy(
        out.data,
        (y * w + x) * 4,
      );
    }
  }
  return out;
}

/** 生成指定画布尺寸的图标：优先整数放大，放不下时退化为最近邻缩小。 */
function iconAt(native, size) {
  let factor = Math.max(1, Math.floor((size * ICON_FILL) / native.width));
  while (factor > 1 && native.width * factor > size) factor -= 1;
  if (native.width * factor > size) {
    return centerOnCanvas(scaleNearest(native, (size * ICON_FILL) / native.width), size);
  }
  return centerOnCanvas(scaleNearest(native, factor), size);
}

function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((entry, index) => {
    const p = index * 16;
    dir[p] = entry.size >= 256 ? 0 : entry.size;
    dir[p + 1] = entry.size >= 256 ? 0 : entry.size;
    dir[p + 2] = 0;
    dir[p + 3] = 0;
    dir.writeUInt16LE(1, p + 4);
    dir.writeUInt16LE(32, p + 6);
    dir.writeUInt32LE(entry.png.length, p + 8);
    dir.writeUInt32LE(offset, p + 12);
    offset += entry.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((entry) => entry.png)]);
}

mkdirSync(ICON_DIR, { recursive: true });

const strip = keyOutColor(decodePng(readFileSync(SOURCE)), BACKGROUND_RGB);
const sprites = splitSprites(strip);
if (sprites.length === 0) throw new Error("no mascot found in source image");
console.log(`切出 ${sprites.length} 只小猫`);

const appSource = sprites[APP_ICON_INDEX];
if (!appSource) throw new Error(`mascot #${APP_ICON_INDEX + 1} is missing`);
const nativeIcon = toNativeGrid(appSource);
console.log(`应用图标：第 ${APP_ICON_INDEX + 1} 只，原生 ${nativeIcon.width}×${nativeIcon.height}`);

const iconPngs = [];
for (const size of ICON_SIZES) {
  const png = encodePng(iconAt(nativeIcon, size));
  writeFileSync(join(ICON_DIR, `icon-${size}.png`), png);
  iconPngs.push({ size, png });
  console.log(`  assets/icons/icon-${size}.png`);
}

// icns 用 iconutil 生成，需要一份标准命名的 iconset。
const iconset = join(ICON_DIR, "Shipcat.iconset");
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
const ICNS_MAP = [
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
  [1024, "icon_512x512@2x.png"],
];
for (const [size, name] of ICNS_MAP) {
  const entry = iconPngs.find((item) => item.size === size);
  if (entry) writeFileSync(join(iconset, name), entry.png);
}

writeFileSync(
  join(ICON_DIR, "icon.ico"),
  buildIco(
    [16, 32, 64, 128, 256].map((size) => ({
      size,
      png: iconPngs.find((item) => item.size === size).png,
    })),
  ),
);
console.log("  assets/icons/icon.ico");

writeFileSync(join(ICON_DIR, "icon.png"), iconPngs.find((item) => item.size === 1024).png);
console.log("  assets/icons/icon.png");

// macOS：直接用 iconutil 打包 .icns（Windows/Linux 上没有这个命令，跳过）。
if (process.platform === "darwin") {
  const result = spawnSync(
    "iconutil",
    ["-c", "icns", iconset, "-o", join(ICON_DIR, "Shipcat.icns")],
    { encoding: "utf8" },
  );
  rmSync(iconset, { recursive: true, force: true });
  if (result.status === 0) console.log("  assets/icons/Shipcat.icns");
  else console.warn(`iconutil 失败：${result.stderr || result.error}`);
}
console.log("完成。");
