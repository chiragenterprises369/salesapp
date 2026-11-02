/**
 * Minimal QR Code encoder (ISO/IEC 18004): byte mode, error correction level M, versions 1-10
 * (up to 213 bytes, enough for download links). No dependency. Structure follows the well-known
 * reference design by Project Nayuki (MIT): function patterns, Reed-Solomon over GF(256) with
 * 0x11D, block interleaving, zigzag placement and the lowest-penalty mask of the eight.
 */

// Level M tables, index = version (0 unused).
const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VERSION = 10;
/** Format bits of level M. */
const ECL_M_BITS = 0;

export interface QrMatrix {
  size: number;
  version: number;
  mask: number;
  /** modules[y][x], true = dark */
  modules: boolean[][];
}

const getBit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(ver: number): number {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver]! * BLOCKS_M[ver]!;
}

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

export function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

export function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => (result[i]! ^= gfMultiply(coef, factor)));
  }
  return result;
}

function alignmentPositions(ver: number, size: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** Format information for level M and a mask (15 bits, BCH + 0x5412 mask). */
export function formatBits(mask: number): number {
  const data = (ECL_M_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function encodeData(bytes: Uint8Array): { version: number; codewords: number[] } {
  let version = 0;
  for (let v = 1; v <= MAX_VERSION; v++) {
    const countBits = v < 10 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCodewords(v) * 8) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error('Text too long for a QR code (max 213 bytes)');
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  bytes.forEach((b) => push(b, 8));
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return { version, codewords };
}

function addEccAndInterleave(data: number[], ver: number): number[] {
  const numBlocks = BLOCKS_M[ver]!;
  const eccLen = ECC_PER_BLOCK_M[ver]!;
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= numShort) result.push(block[i]!);
    });
  }
  return result;
}

class Grid {
  modules: boolean[][];
  fn: boolean[][];
  constructor(readonly size: number) {
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  setFn(x: number, y: number, dark: boolean) {
    this.modules[y]![x] = dark;
    this.fn[y]![x] = true;
  }
}

function drawFunctionPatterns(g: Grid, ver: number) {
  const { size } = g;
  for (let i = 0; i < size; i++) {
    g.setFn(6, i, i % 2 === 0);
    g.setFn(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) g.setFn(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const pos = alignmentPositions(ver, size);
  const n = pos.length;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) g.setFn(pos[i]! + dx, pos[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  drawFormat(g, 0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = getBit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      g.setFn(a, b, dark);
      g.setFn(b, a, dark);
    }
  }
}

function drawFormat(g: Grid, mask: number) {
  const bits = formatBits(mask);
  const { size } = g;
  for (let i = 0; i <= 5; i++) g.setFn(8, i, getBit(bits, i));
  g.setFn(8, 7, getBit(bits, 6));
  g.setFn(8, 8, getBit(bits, 7));
  g.setFn(7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i++) g.setFn(14 - i, 8, getBit(bits, i));
  for (let i = 0; i < 8; i++) g.setFn(size - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i++) g.setFn(8, size - 15 + i, getBit(bits, i));
  g.setFn(8, size - 8, true);
}

function drawCodewords(g: Grid, data: number[]) {
  const { size } = g;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!g.fn[y]![x] && i < data.length * 8) {
          g.modules[y]![x] = getBit(data[i >>> 3]!, 7 - (i & 7));
          i++;
        }
      }
  }
}

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(g: Grid, mask: number) {
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) if (!g.fn[y]![x] && maskBit(mask, x, y)) g.modules[y]![x] = !g.modules[y]![x];
}

/** Penalty rules N1 (runs), N2 (2x2 blocks), N3 (finder-like 1:1:3:1:1 with 4 light) and N4 (balance). */
function penalty(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    const pattern = [true, false, true, true, true, false, true];
    for (let i = 0; i + 7 <= size; i++) {
      if (!pattern.every((p, k) => get(i + k) === p)) continue;
      const before = i >= 4 && [1, 2, 3, 4].every((k) => !get(i - k));
      const after = i + 11 <= size && [7, 8, 9, 10].every((k) => !get(i + k));
      if (before || after) score += 40;
    }
  };
  for (let y = 0; y < size; y++) line((x) => m[y]![x]!);
  for (let x = 0; x < size; x++) line((y) => m[y]![x]!);
  let dark = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (m[y]![x]) dark++;
      if (x + 1 < size && y + 1 < size) {
        const c = m[y]![x];
        if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) score += 3;
      }
    }
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  score += Math.max(0, k) * 10;
  return score;
}

export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const { version, codewords } = encodeData(bytes);
  const size = version * 4 + 17;
  const all = addEccAndInterleave(codewords, version);
  let best: { mask: number; score: number; modules: boolean[][] } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    const g = new Grid(size);
    drawFunctionPatterns(g, version);
    drawCodewords(g, all);
    applyMask(g, mask);
    drawFormat(g, mask);
    const score = penalty(g.modules);
    if (!best || score < best.score) best = { mask, score, modules: g.modules };
  }
  return { size, version, mask: best!.mask, modules: best!.modules };
}

/** SVG path data for the dark modules, offset by a quiet zone (in modules). */
export function qrPath(m: QrMatrix, quiet = 4): string {
  const parts: string[] = [];
  for (let y = 0; y < m.size; y++)
    for (let x = 0; x < m.size; x++) if (m.modules[y]![x]) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
  return parts.join('');
}
