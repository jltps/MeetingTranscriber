// Brand-asset generator for Nexus (ROADMAP_V04_09). Dependency-free: rasterizes the
// monogram "N" mark in pure JS and encodes PNG (via node:zlib) + a Windows .ico. No
// native image libs (the repo deliberately ships no rasterizer / build toolchain), so
// this script is the reproducible source of truth — re-run it after editing the mark
// and commit the generated build/icon.{ico,png}.
//
//   node build/make-icons.mjs
//
// The mark: a rounded-square tile with an emerald→teal diagonal gradient and a white
// geometric "N". All geometry is expressed in a 256-unit design space; a single 1024²
// master is rendered and box-downsampled to each output size for clean anti-aliasing.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));

// --- Palette (matches Block 01 tokens: emerald → teal-700 --primary #0f766e) ---------
const EMERALD = [16, 185, 129]; // #10b981 (top-left)
const TEAL = [15, 118, 110]; //    #0f766e (bottom-right)
const WHITE = [255, 255, 255];

// --- Design-space geometry (256 units) ------------------------------------------------
const U = 256;
const RADIUS = 56; // tile corner radius (~22%)

// Monogram "N": two vertical bars + a diagonal, as filled regions in 256-space.
const BAR_TOP = 64;
const BAR_BOT = 192;
const LEFT_X0 = 70;
const LEFT_X1 = 98;
const RIGHT_X0 = 158;
const RIGHT_X1 = 186;
// Diagonal parallelogram: long edges (70,64)->(158,192) and (98,64)->(186,192).

function insideRoundRect(x, y) {
  // Distance test against a rounded rectangle filling the whole [0,U] tile.
  const r = RADIUS;
  const cx = Math.min(Math.max(x, r), U - r);
  const cy = Math.min(Math.max(y, r), U - r);
  if (x >= r && x <= U - r) return y >= 0 && y <= U; // straight vertical band
  if (y >= r && y <= U - r) return x >= 0 && x <= U; // straight horizontal band
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r; // rounded corner
}

function insideN(x, y) {
  if (y < BAR_TOP || y > BAR_BOT) return false;
  if (x >= LEFT_X0 && x <= LEFT_X1) return true; // left bar
  if (x >= RIGHT_X0 && x <= RIGHT_X1) return true; // right bar
  // Diagonal: x bounded by the two slanted edges at this y.
  const t = (y - BAR_TOP) / (BAR_BOT - BAR_TOP); // 0..1
  const lead = (RIGHT_X0 - LEFT_X0) * t; // shear amount
  const leftEdge = LEFT_X0 + lead;
  const rightEdge = LEFT_X1 + lead;
  return x >= leftEdge && x <= rightEdge;
}

// --- Render the 1024² master (RGBA) ---------------------------------------------------
function renderMaster(S) {
  const k = S / U;
  const buf = Buffer.alloc(S * S * 4); // zero = transparent
  for (let py = 0; py < S; py++) {
    const yu = (py + 0.5) / k;
    for (let px = 0; px < S; px++) {
      const xu = (px + 0.5) / k;
      const i = (py * S + px) * 4;
      if (!insideRoundRect(xu, yu)) continue; // transparent outside the tile
      let color;
      if (insideN(xu, yu)) {
        color = WHITE;
      } else {
        const f = Math.min(1, Math.max(0, (xu + yu) / (2 * U))); // diagonal blend
        color = [
          Math.round(EMERALD[0] + (TEAL[0] - EMERALD[0]) * f),
          Math.round(EMERALD[1] + (TEAL[1] - EMERALD[1]) * f),
          Math.round(EMERALD[2] + (TEAL[2] - EMERALD[2]) * f),
        ];
      }
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
      buf[i + 3] = 255;
    }
  }
  return buf;
}

// Box-downsample the master (premultiplied so transparent edges don't darken).
function downsample(master, S, target) {
  const scale = S / target;
  const out = Buffer.alloc(target * target * 4);
  for (let ty = 0; ty < target; ty++) {
    for (let tx = 0; tx < target; tx++) {
      const x0 = Math.floor(tx * scale);
      const y0 = Math.floor(ty * scale);
      const x1 = Math.floor((tx + 1) * scale);
      const y1 = Math.floor((ty + 1) * scale);
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * S + sx) * 4;
          const af = master[i + 3] / 255;
          r += master[i] * af;
          g += master[i + 1] * af;
          b += master[i + 2] * af;
          a += master[i + 3];
          n++;
        }
      }
      const alpha = a / n;
      const o = (ty * target + tx) * 4;
      if (alpha > 0) {
        const sumAf = a / 255; // = Σ af
        out[o] = Math.round(r / sumAf);
        out[o + 1] = Math.round(g / sumAf);
        out[o + 2] = Math.round(b / sumAf);
        out[o + 3] = Math.round(alpha);
      }
    }
  }
  return out;
}

// --- PNG encoding (8-bit RGBA, single IDAT) -------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(rgba, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  // Raw scanlines, each prefixed with filter byte 0 (none).
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// --- ICO assembly (PNG-embedded entries, valid since Vista) ---------------------------
function buildICO(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  images.forEach((img, idx) => {
    const e = idx * 16;
    dir[e] = img.size >= 256 ? 0 : img.size; // 0 means 256
    dir[e + 1] = img.size >= 256 ? 0 : img.size;
    dir[e + 2] = 0; // palette count
    dir[e + 3] = 0; // reserved
    dir.writeUInt16LE(1, e + 4); // color planes
    dir.writeUInt16LE(32, e + 6); // bits per pixel
    dir.writeUInt32LE(img.png.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += img.png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

// --- Generate -------------------------------------------------------------------------
const MASTER = 1024;
const ICO_SIZES = [16, 32, 48, 64, 128, 256];

const master = renderMaster(MASTER);

const icoImages = ICO_SIZES.map((size) => ({
  size,
  png: encodePNG(downsample(master, MASTER, size), size, size),
}));
writeFileSync(join(OUT_DIR, 'icon.ico'), buildICO(icoImages));

// A 256² PNG source (used as the BrowserWindow icon + a general-purpose source).
writeFileSync(join(OUT_DIR, 'icon.png'), encodePNG(downsample(master, MASTER, 256), 256, 256));

console.log(`Wrote build/icon.ico (${ICO_SIZES.join(', ')}) and build/icon.png`);
