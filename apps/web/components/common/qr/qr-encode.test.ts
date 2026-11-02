import { describe, expect, it } from 'vitest';
import { encodeQr, formatBits, rsDivisor, rsRemainder } from './qr-encode';

describe('qr-encode', () => {
  it('computes Reed-Solomon ECC for the 1-M "HELLO WORLD" example', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, rsDivisor(10))).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it('writes the level M format information', () => {
    expect(formatBits(0).toString(2).padStart(15, '0')).toBe('101010000010010');
    expect(formatBits(5).toString(2).padStart(15, '0')).toBe('100000011001110');
  });

  it('picks the smallest version and draws the finder patterns', () => {
    const short = encodeQr('https://vistar.app');
    expect(short.version).toBe(2);
    expect(short.size).toBe(25);
    const long = encodeQr(`http://localhost:3001/api/v1/app/android/releases/${'x'.repeat(60)}/download`);
    expect(long.version).toBeGreaterThanOrEqual(5);
    for (const m of [short, long]) {
      const s = m.size;
      // Finder corners are dark, separators light.
      for (const [x, y] of [
        [0, 0],
        [s - 1, 0],
        [0, s - 1],
      ] as const) {
        expect(m.modules[y]![x]).toBe(true);
      }
      expect(m.modules[7]![7]).toBe(false);
      // Dark module next to the bottom-left finder.
      expect(m.modules[s - 8]![8]).toBe(true);
      // Timing pattern alternates.
      expect(m.modules[6]![8]).toBe(true);
      expect(m.modules[6]![9]).toBe(false);
    }
  });

  it('rejects text that does not fit version 10', () => {
    expect(() => encodeQr('x'.repeat(300))).toThrow();
  });
});
