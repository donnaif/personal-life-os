import zlib from 'node:zlib';

/**
 * Deterministic app icon generator (no image tooling on this machine).
 * Renders the favicon artwork (rounded teal tile + white "N") at any size and
 * wraps it in a real PNG and a PNG-in-ICO container for Windows packaging.
 */

export const ICON_SIZE = 256;
const TILE = [0x0f, 0x76, 0x6e] as const;
const GLYPH = [0xf8, 0xfa, 0xfc] as const;
const CORNER_RADIUS_RATIO = 14 / 64;
const SUPERSAMPLE = 4;

const GLYPH_POLYGON: readonly (readonly [number, number])[] = [
  [20, 18],
  [26, 18],
  [38, 35],
  [38, 18],
  [44, 18],
  [44, 46],
  [38, 46],
  [26, 29],
  [26, 46],
  [20, 46],
];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pointInPolygon(x: number, y: number, polygon: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInRoundedSquare(x: number, y: number, size: number, radius: number): boolean {
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

export function renderIconRgba(size: number = ICON_SIZE): Buffer {
  const out = Buffer.alloc(size * size * 4);
  const scale = size / 64;
  const radius = CORNER_RADIUS_RATIO * size;
  const polygon = GLYPH_POLYGON.map(([x, y]) => [x * scale, y * scale] as const);
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let tileHits = 0;
      let glyphHits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = px + (sx + 0.5) / SUPERSAMPLE;
          const y = py + (sy + 0.5) / SUPERSAMPLE;
          if (!pointInRoundedSquare(x, y, size, radius)) continue;
          tileHits += 1;
          if (pointInPolygon(x, y, polygon)) glyphHits += 1;
        }
      }
      const offset = (py * size + px) * 4;
      if (tileHits === 0) {
        out[offset] = 0;
        out[offset + 1] = 0;
        out[offset + 2] = 0;
        out[offset + 3] = 0;
        continue;
      }
      const glyphRatio = glyphHits / samples;
      const coverage = tileHits / samples;
      for (let channel = 0; channel < 3; channel += 1) {
        const tile = TILE[channel]!;
        const glyph = GLYPH[channel]!;
        out[offset + channel] = Math.round(tile + (glyph - tile) * glyphRatio);
      }
      out[offset + 3] = Math.round(coverage * 255);
    }
  }
  return out;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  if (rgba.length !== width * height * 4) throw new Error('rgba buffer size mismatch');
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function encodeIco(png: Buffer, size: number = ICON_SIZE): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);

  return Buffer.concat([header, entry, png]);
}

export interface IconSet {
  png: Buffer;
  ico: Buffer;
  size: number;
}

export function buildIcons(size: number = ICON_SIZE): IconSet {
  const png = encodePng(size, size, renderIconRgba(size));
  return { png, ico: encodeIco(png, size), size };
}
