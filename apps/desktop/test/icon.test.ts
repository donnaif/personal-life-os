import { describe, expect, it } from 'vitest';
import { buildIcons, crc32, encodeIco, encodePng, renderIconRgba } from '../src/icon.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('icon rendering', () => {
  it('renders an opaque tile with transparent rounded corners', () => {
    const size = 64;
    const rgba = renderIconRgba(size);
    expect(rgba.length).toBe(size * size * 4);

    const corner = (2 * size + 2) * 4;
    expect(rgba[corner + 3]).toBe(0);

    const tileOnly = (32 * size + 8) * 4;
    expect(rgba[tileOnly + 3]).toBe(255);
    expect(rgba[tileOnly]).toBeGreaterThan(10);
    expect(rgba[tileOnly]).toBeLessThan(30);
    expect(rgba[tileOnly + 1]).toBeGreaterThan(100);
    expect(rgba[tileOnly + 2]).toBeGreaterThan(95);
  });

  it('writes a valid png container', () => {
    const size = 32;
    const png = encodePng(size, size, renderIconRgba(size));
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND');
    const ihdrCrc = crc32(png.subarray(12, 29));
    expect(png.readUInt32BE(29)).toBe(ihdrCrc);
  });

  it('wraps the png in an ico container with a correct entry', () => {
    const size = 256;
    const png = encodePng(size, size, renderIconRgba(size));
    const ico = encodeIco(png, size);
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(1);
    expect(ico[6]).toBe(0);
    expect(ico[7]).toBe(0);
    expect(ico.readUInt16LE(10)).toBe(1);
    expect(ico.readUInt16LE(12)).toBe(32);
    expect(ico.readUInt32LE(14)).toBe(png.length);
    expect(ico.readUInt32LE(18)).toBe(22);
    expect(ico.subarray(22, 22 + 8).equals(PNG_SIGNATURE)).toBe(true);
  });

  it('builds the standard 256px icon pair', () => {
    const { png, ico, size } = buildIcons();
    expect(size).toBe(256);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(ico.length).toBe(png.length + 22);
  });

  it('throws when the rgba buffer does not match the size', () => {
    expect(() => encodePng(4, 4, Buffer.alloc(8))).toThrow(/size mismatch/);
  });
});
