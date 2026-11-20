/**
 * 小猫素材：把导出的 GIF 处理成欢迎页可用的透明底动图 + 与动图同画幅的静态图。
 *
 * 为什么需要静态图：GIF 是 512×512 整块画布（猫本体只占约 72%），
 * 紧贴猫身裁出的 PNG 只有 200×184。两者放在同一个盒子里，切换时猫会
 * 忽大忽小 —— 所以静态图也从 GIF 的第 1 帧导出，画幅、位置、大小完全一致。
 *
 * 处理步骤：
 * 1. 给每个 GIF 的每个 Graphic Control Extension 打上「背景色透明」，不改画面、不重新编码；
 * 2. 用 sips 把眨眼 GIF 的第 1 帧转成 PNG（猫睁眼、尾巴静止的中性姿势）；
 * 3. 抠掉背景色写成 cat-N.png（512 画幅）；再按包围盒裁出 cat-N-mark.png（设置页 16px 用）。
 *
 * 输入：assets/source/gifs/*.gif（cat_4_blink.gif 这种命名）
 * 输出：ui/renderer/assets/mascots/cat-4-blink.gif、cat-4.png、cat-4-mark.png ……
 *
 * 换图流程：替换 assets/source/gifs → npm run mascots
 * 注意：第 2 步依赖 macOS 的 sips；其它平台上已生成的 PNG 会保留，不重新导出。
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { alphaBounds, crop, decodePng, encodePng, keyOutColor } from "./lib/png.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = join(ROOT, "assets", "source", "gifs");
const OUTPUT_DIR = join(ROOT, "ui", "renderer", "assets", "mascots");

const BACKGROUND_RGB = [245, 243, 240];

/* ------------------------------------------------------------------ */
/* GIF 透明化（字节级，不重新编码）                                     */
/* ------------------------------------------------------------------ */

function paletteIndex(buffer) {
  const flags = buffer[10];
  if ((flags & 0x80) === 0) return -1;
  const size = 2 ** ((flags & 0x07) + 1);
  for (let i = 0; i < size; i += 1) {
    const offset = 13 + i * 3;
    if (
      buffer[offset] === BACKGROUND_RGB[0] &&
      buffer[offset + 1] === BACKGROUND_RGB[1] &&
      buffer[offset + 2] === BACKGROUND_RGB[2]
    ) {
      return i;
    }
  }
  return buffer[11];
}

function makeTransparent(buffer, transparentIndex) {
  const out = Buffer.from(buffer);
  const flags = out[10];
  const gctSize = (flags & 0x80) !== 0 ? 3 * 2 ** ((flags & 0x07) + 1) : 0;
  let pos = 13 + gctSize;
  let frames = 0;
  while (pos < out.length) {
    const block = out[pos];
    if (block === 0x21) {
      if (out[pos + 1] === 0xf9) {
        // bit0 = 透明色标志，bit2-4 = 处置方式（固定 1：保留上一帧）。
        out[pos + 3] = (out[pos + 3] & 0b11111000) | 0b00000101;
        out[pos + 6] = transparentIndex;
      }
      pos += 2;
      while (out[pos] !== 0) pos += out[pos] + 1;
      pos += 1;
    } else if (block === 0x2c) {
      frames += 1;
      const localFlags = out[pos + 9];
      pos += 10;
      if ((localFlags & 0x80) !== 0) pos += 3 * 2 ** ((localFlags & 0x07) + 1);
      pos += 1;
      while (out[pos] !== 0) pos += out[pos] + 1;
      pos += 1;
    } else if (block === 0x3b) {
      break;
    } else {
      pos += 1;
    }
  }
  return { data: out, frames };
}

/* ------------------------------------------------------------------ */
/* 从 GIF 第 1 帧导出静态图                                            */
/* ------------------------------------------------------------------ */

function exportStill(gifPath, targetBase) {
  const tmp = join(OUTPUT_DIR, `.frame-${Date.now()}.png`);
  const converted = spawnSync("sips", ["-s", "format", "png", gifPath, "--out", tmp], {
    encoding: "utf8",
  });
  if (converted.status !== 0) {
    rmSync(tmp, { force: true });
    throw new Error(`sips 转换失败：${converted.stderr || converted.error}`);
  }
  const frame = keyOutColor(decodePng(readFileSync(tmp)), BACKGROUND_RGB);
  rmSync(tmp, { force: true });

  // 与 GIF 同画幅（512×512），切换动作时猫不会跳大小。
  writeFileSync(join(OUTPUT_DIR, `${targetBase}.png`), encodePng(frame));

  // 设置页 16px 的小标：紧贴猫身裁一刀，避免画幅留白把猫缩没。
  const bounds = alphaBounds(frame);
  if (bounds) {
    const mark = crop(frame, bounds.x, bounds.y, bounds.width, bounds.height);
    writeFileSync(join(OUTPUT_DIR, `${targetBase}-mark.png`), encodePng(mark));
  }
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

mkdirSync(OUTPUT_DIR, { recursive: true });

let files;
try {
  files = readdirSync(SOURCE_DIR).filter((name) => name.toLowerCase().endsWith(".gif"));
} catch {
  console.error("缺少素材目录：assets/source/gifs");
  process.exit(1);
}
if (files.length === 0) {
  console.error("assets/source/gifs 里没有 GIF");
  process.exit(1);
}

const sorted = files.sort();
for (const name of sorted) {
  const buffer = readFileSync(join(SOURCE_DIR, name));
  const { data, frames } = makeTransparent(buffer, paletteIndex(buffer));
  const target = name.replace(/_/g, "-").toLowerCase();
  writeFileSync(join(OUTPUT_DIR, target), data);
  console.log(`  ${name} → mascots/${target}  ${frames} 帧`);
}

// 每只猫用眨眼 GIF 的第 1 帧作为静态图（睁眼、尾巴静止的中性姿势）。
const stills = sorted.filter((name) => name.includes("_blink"));
if (process.platform !== "darwin") {
  console.warn("非 macOS 环境：跳过静态图导出（sips 不可用），保留已有 PNG。");
} else {
  for (const name of stills) {
    const cat = name.match(/cat_(\d+)_/)?.[1];
    if (!cat) continue;
    exportStill(join(SOURCE_DIR, name), `cat-${cat}`);
    console.log(`  cat-${cat}.png / cat-${cat}-mark.png`);
  }
}

console.log("完成。");
