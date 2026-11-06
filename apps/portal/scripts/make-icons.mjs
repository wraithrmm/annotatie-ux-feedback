// Draws the portal's PNG icons (the same mark as public/icon.svg) without any image library.
// Run: node apps/portal/scripts/make-icons.mjs  (the PNGs are committed; rerun only to change them)
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [0x3b, 0x4c, 0xca];
// The "A" on a 512 grid: outer triangle-ish outline and the counter (hole), as polygons.
const OUTER = [[256, 104], [384, 408], [330, 408], [302, 336], [210, 336], [182, 408], [128, 408]];
const HOLE = [[228, 288], [284, 288], [256, 214]];

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRoundRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), 512 - r);
  const cy = Math.min(Math.max(y, r), 512 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, maskable) {
  const S = 4; // supersampling
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const markScale = maskable ? 0.72 : 1;
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const x = ((px + (sx + 0.5) / S) / size) * 512;
          const y = ((py + (sy + 0.5) / S) / size) * 512;
          const inBg = maskable ? true : inRoundRect(x, y, 112);
          if (!inBg) continue;
          bg++;
          const mx = 256 + (x - 256) / markScale;
          const my = 256 + (y - 256) / markScale;
          if (inPoly(mx, my, OUTER) && !inPoly(mx, my, HOLE)) fg++;
        }
      const n = S * S;
      const a = bg / n;
      const f = bg ? fg / bg : 0;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = Math.round(BG[0] * (1 - f) + 255 * f);
      raw[o + 1] = Math.round(BG[1] * (1 - f) + 255 * f);
      raw[o + 2] = Math.round(BG[2] * (1 - f) + 255 * f);
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = new URL("../public/", import.meta.url);
writeFileSync(new URL("icon-192.png", out), png(192, false));
writeFileSync(new URL("icon-512.png", out), png(512, false));
writeFileSync(new URL("icon-maskable-512.png", out), png(512, true));
console.log("icons written");
