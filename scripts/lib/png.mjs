/**
 * 图标 / 动图生成共用的小型 PNG 编解码与像素工具（无第三方依赖）。
 *
 * 只支持本项目会用到的最小子集：8 位 RGB / RGBA、非隔行。够处理 sips 导出的
 * 帧和像素画素材；不做调色板 PNG。被 scripts/build-icons.mjs 与
 * scripts/build-mascots.mjs 共用。
 */

import zlib from "node:zlib";

/* ------------------------------------------------------------------ */
/* 解码                                                                */
/* ------------------------------------------------------------------ */

export function decodePng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported png: bitDepth=${bitDepth} colorType=${colorType}`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = value & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const s = x * bpp;
      const d = (y * width + x) * 4;
      out[d] = cur[s];
      out[d + 1] = cur[s + 1];
      out[d + 2] = cur[s + 2];
      out[d + 3] = bpp === 4 ? cur[s + 3] : 255;
    }
    prev = cur;
  }
  return { width, height, data: out };
}

/* ------------------------------------------------------------------ */
/* 编码                                                                */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(image) {
  const { width, height, data } = image;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* 像素操作                                                            */
/* ------------------------------------------------------------------ */

export function createImage(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

export function pixelAt(image, x, y) {
  const i = (y * image.width + x) * 4;
  return image.data.subarray(i, i + 4);
}

/** 裁出矩形；越界部分视为透明。 */
export function crop(image, x0, y0, w, h) {
  const out = createImage(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const sx = x0 + x;
      const sy = y0 + y;
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
      pixelAt(image, sx, sy).copy(out.data, (y * w + x) * 4);
    }
  }
  return out;
}

/** 最近邻缩放：factor 为整数时每个像素块大小一致。 */
export function scaleNearest(image, factor) {
  const w = Math.round(image.width * factor);
  const h = Math.round(image.height * factor);
  const out = createImage(w, h);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(image.height - 1, Math.floor(y / factor));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(image.width - 1, Math.floor(x / factor));
      pixelAt(image, sx, sy).copy(out.data, (y * w + x) * 4);
    }
  }
  return out;
}

/** 把 src 居中画到 size×size 的透明画布上。 */
export function centerOnCanvas(src, size) {
  const out = createImage(size, size);
  const ox = Math.round((size - src.width) / 2);
  const oy = Math.round((size - src.height) / 2);
  for (let y = 0; y < src.height; y += 1) {
    const ty = y + oy;
    if (ty < 0 || ty >= size) continue;
    for (let x = 0; x < src.width; x += 1) {
      const tx = x + ox;
      if (tx < 0 || tx >= size) continue;
      pixelAt(src, x, y).copy(out.data, (ty * size + tx) * 4);
    }
  }
  return out;
}

/** 把指定颜色整块变成透明（像素画是纯色块，不会留毛边）。 */
export function keyOutColor(image, rgb) {
  const out = createImage(image.width, image.height);
  image.data.copy(out.data);
  for (let i = 0; i < out.data.length; i += 4) {
    if (
      out.data[i] === rgb[0] &&
      out.data[i + 1] === rgb[1] &&
      out.data[i + 2] === rgb[2]
    ) {
      out.data[i + 3] = 0;
    }
  }
  return out;
}

/** 不透明像素的包围盒；全透明时返回 null。 */
export function alphaBounds(image) {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (pixelAt(image, x, y)[3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
