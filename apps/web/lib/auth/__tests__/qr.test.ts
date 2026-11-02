import { describe, expect, it } from 'vitest';
import { formatBits, gfMultiply, numDataCodewords, qrMatrix, qrSvgPath, rsRemainder, versionBits } from '../qr';

/**
 * QR encoder checks against published values (capacity table, format/version BCH codes, the
 * Reed-Solomon example "HELLO WORLD" 1-M) and an independent decode of generated symbols: read the
 * format bits, unmask, read codewords in placement order, de-interleave, verify every block's RS
 * syndromes are zero and recover the original bytes.
 */

describe('tables and codes', () => {
  it('data codewords at level M match the standard (byte capacity = codewords minus the 2-3 header bytes)', () => {
    expect([1, 2, 5, 7, 10, 20, 40].map(numDataCodewords)).toEqual([16, 28, 86, 124, 216, 669, 2334]);
  });

  it('format and version information', () => {
    expect(formatBits(0)).toBe(0b101010000010010);
    expect(versionBits(7)).toBe(0x07c94);
  });

  it('Reed-Solomon matches the 1-M "HELLO WORLD" example', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    // Generator of degree 10 built like the encoder does.
    const divisor = rsDivisorForTest(10);
    expect(rsRemainder(data, divisor)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
});

function rsDivisorForTest(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

// ------------------------------------------------------------------ independent decoder

const ECC = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];

function gfPow2(n: number): number {
  let x = 1;
  for (let i = 0; i < n; i++) x = gfMultiply(x, 2);
  return x;
}

function functionMask(size: number, ver: number): boolean[][] {
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < size && y < size) fn[y]![x] = true;
  };
  for (let i = 0; i < size; i++) {
    mark(6, i);
    mark(i, 6);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) mark(cx! + dx, cy! + dy);
  }
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2;
    const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    const pos = [6];
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(pos[i]! + dx, pos[j]! + dy);
      }
  }
  for (let i = 0; i < 9; i++) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    mark(size - 1 - i, 8);
    mark(8, size - 1 - i);
  }
  if (ver >= 7)
    for (let i = 0; i < 18; i++) {
      mark(size - 11 + (i % 3), Math.floor(i / 3));
      mark(Math.floor(i / 3), size - 11 + (i % 3));
    }
  return fn;
}

const MASKS = [
  (x: number, y: number) => (x + y) % 2 === 0,
  (_x: number, y: number) => y % 2 === 0,
  (x: number) => x % 3 === 0,
  (x: number, y: number) => (x + y) % 3 === 0,
  (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function decode(m: boolean[][]): string {
  const size = m.length;
  const ver = (size - 17) / 4;
  // Format bits from the copy around the top-left finder.
  let fmt = 0;
  const bitAt = (x: number, y: number) => (m[y]![x] ? 1 : 0);
  const order: Array<[number, number]> = [];
  for (let i = 0; i <= 5; i++) order.push([8, i]);
  order.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i++) order.push([14 - i, 8]);
  order.forEach(([x, y], i) => (fmt |= bitAt(x, y) << i));
  const data5 = (fmt ^ 0x5412) >>> 10;
  expect(data5 >>> 3).toBe(0); // level M
  const mask = data5 & 7;
  expect(formatBits(mask)).toBe(fmt);

  const fn = functionMask(size, ver);
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (fn[y]![x]) continue;
        bits.push((m[y]![x] ? 1 : 0) ^ (MASKS[mask]!(x, y) ? 1 : 0));
      }
    }
  }
  const raw: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) raw.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  const nb = BLOCKS[ver]!;
  const ecc = ECC[ver]!;
  const total = raw.length;
  const shortLen = Math.floor(total / nb);
  const numShort = nb - (total % nb);
  let k = 0;
  // De-interleave: data columns first (short blocks have one data codeword less), then ECC columns.
  const dataLens = Array.from({ length: nb }, (_, j) => (j < numShort ? shortLen : shortLen + 1) - ecc);
  const out: number[][] = dataLens.map(() => []);
  const maxData = Math.max(...dataLens);
  for (let i = 0; i < maxData; i++) for (let j = 0; j < nb; j++) if (i < dataLens[j]!) out[j]!.push(raw[k++]!);
  for (let i = 0; i < ecc; i++) for (let j = 0; j < nb; j++) out[j]!.push(raw[k++]!);

  const dataBytes: number[] = [];
  out.forEach((block, j) => {
    // Syndromes S_i = C(alpha^i) must be zero for i in 0..ecc-1.
    for (let s = 0; s < ecc; s++) {
      const a = gfPow2(s);
      let acc = 0;
      for (const c of block) acc = gfMultiply(acc, a) ^ c;
      expect(acc).toBe(0);
    }
    dataBytes.push(...block.slice(0, dataLens[j]!));
  });

  const stream = dataBytes.flatMap((b) => Array.from({ length: 8 }, (_, i) => (b >>> (7 - i)) & 1));
  let p = 0;
  const read = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | stream[p++]!;
    return v;
  };
  expect(read(4)).toBe(0b0100);
  const count = read(ver < 10 ? 8 : 16);
  const bytes = Array.from({ length: count }, () => read(8));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

describe('encode and decode', () => {
  const samples = [
    'HELLO WORLD',
    'otpauth://totp/Vistar%20Super%20Admin%3Aowner%40vistar.example?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Vistar%20Super%20Admin&algorithm=SHA1&digits=6&period=30',
    'x'.repeat(300),
  ];
  for (const text of samples) {
    it(`round-trips ${text.length} bytes`, () => {
      const m = qrMatrix(text);
      expect(m.length % 4).toBe(1);
      expect(decode(m)).toBe(text);
    });
  }

  it('renders an SVG path with a quiet zone', () => {
    const { d, size } = qrSvgPath(qrMatrix('HELLO WORLD'));
    expect(size).toBe(21 + 8);
    expect(d.startsWith('M4 4h1v1h-1z')).toBe(true);
  });
});
