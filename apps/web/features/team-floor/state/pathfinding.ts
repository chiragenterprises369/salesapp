import type { WalkGrid } from './layout';

/**
 * Grid A* (8-neighbour, diagonal cost 1.4, no corner cutting) with a per (from, to) cell cache,
 * line-of-sight simplification and Catmull-Rom smoothing. No three.js: plain typed arrays.
 */

export interface FollowPath {
  xs: Float32Array;
  zs: Float32Array;
  /** Cumulative length at each sample. */
  cum: Float32Array;
  length: number;
}

const SQRT2 = 1.4;
const CACHE_MAX = 400;

export class PathFinder {
  private readonly grid: WalkGrid;
  private readonly g: Float32Array;
  private readonly f: Float32Array;
  private readonly came: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly heap: Int32Array;
  private heapSize = 0;
  private gen = 0;
  private readonly cache = new Map<string, number[] | null>();

  constructor(grid: WalkGrid) {
    this.grid = grid;
    const n = grid.cols * grid.rows;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.came = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n);
  }

  cellOf(x: number, z: number): number {
    const { cols, rows, cell } = this.grid;
    const i = Math.min(cols - 1, Math.max(0, Math.floor(x / cell)));
    const j = Math.min(rows - 1, Math.max(0, Math.floor(z / cell)));
    return j * cols + i;
  }

  private walkable(i: number, j: number) {
    const { cols, rows, walkable } = this.grid;
    return i >= 0 && j >= 0 && i < cols && j < rows && walkable[j * cols + i] === 1;
  }

  /** Closest walkable cell (ring search). */
  nearestWalkable(cellIndex: number): number {
    const { cols, walkable } = this.grid;
    if (walkable[cellIndex] === 1) return cellIndex;
    const ci = cellIndex % cols;
    const cj = Math.floor(cellIndex / cols);
    for (let r = 1; r < 12; r++) {
      let bestCell = -1;
      let bestD = Number.POSITIVE_INFINITY;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (!this.walkable(ci + di, cj + dj)) continue;
          const d = di * di + dj * dj;
          if (d < bestD) {
            bestD = d;
            bestCell = (cj + dj) * cols + ci + di;
          }
        }
      }
      if (bestCell >= 0) return bestCell;
    }
    return cellIndex;
  }

  /** Smoothed path between two world points, or null when unreachable. */
  route(fromX: number, fromZ: number, toX: number, toZ: number): FollowPath | null {
    const a = this.nearestWalkable(this.cellOf(fromX, fromZ));
    const b = this.nearestWalkable(this.cellOf(toX, toZ));
    const key = `${a}:${b}`;
    let cells = this.cache.get(key);
    if (cells === undefined) {
      cells = a === b ? [a] : this.search(a, b);
      if (cells) cells = this.simplify(cells);
      if (this.cache.size >= CACHE_MAX) {
        const first = this.cache.keys().next().value;
        if (first !== undefined) this.cache.delete(first);
      }
      this.cache.set(key, cells);
    }
    if (!cells) return null;
    const { cols, cell } = this.grid;
    const pts: number[] = [fromX, fromZ];
    for (let k = 1; k < cells.length - 1; k++) {
      const c = cells[k] as number;
      pts.push(((c % cols) + 0.5) * cell, (Math.floor(c / cols) + 0.5) * cell);
    }
    pts.push(toX, toZ);
    return smooth(pts);
  }

  private search(start: number, goal: number): number[] | null {
    const { cols } = this.grid;
    this.gen += 1;
    const gen = this.gen;
    const gx = goal % cols;
    const gz = Math.floor(goal / cols);
    const h = (c: number) => {
      const dx = Math.abs((c % cols) - gx);
      const dz = Math.abs(Math.floor(c / cols) - gz);
      return dx + dz + (SQRT2 - 2) * Math.min(dx, dz);
    };
    this.heapSize = 0;
    this.g[start] = 0;
    this.f[start] = h(start);
    this.came[start] = -1;
    this.seen[start] = gen;
    this.push(start);

    while (this.heapSize > 0) {
      const cur = this.pop();
      if (cur === goal) return this.reconstruct(goal);
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      const ci = cur % cols;
      const cj = Math.floor(cur / cols);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const ni = ci + di;
          const nj = cj + dj;
          if (!this.walkable(ni, nj)) continue;
          const diagonal = di !== 0 && dj !== 0;
          if (diagonal && (!this.walkable(ci + di, cj) || !this.walkable(ci, cj + dj))) continue;
          const n = nj * cols + ni;
          if (this.closed[n] === gen) continue;
          const tentative = this.g[cur]! + (diagonal ? SQRT2 : 1);
          if (this.seen[n] !== gen || tentative < this.g[n]!) {
            this.seen[n] = gen;
            this.g[n] = tentative;
            this.f[n] = tentative + h(n);
            this.came[n] = cur;
            this.push(n);
          }
        }
      }
    }
    return null;
  }

  private reconstruct(goal: number): number[] {
    const out: number[] = [];
    let c = goal;
    while (c !== -1) {
      out.push(c);
      c = this.came[c]!;
    }
    return out.reverse();
  }

  /** Drop waypoints that have line of sight to a later one (string pulling). */
  private simplify(cells: number[]): number[] {
    if (cells.length <= 2) return cells;
    const out = [cells[0] as number];
    let anchor = 0;
    for (let k = 2; k < cells.length; k++) {
      if (!this.lineOfSight(cells[anchor] as number, cells[k] as number)) {
        out.push(cells[k - 1] as number);
        anchor = k - 1;
      }
    }
    out.push(cells[cells.length - 1] as number);
    return out;
  }

  private lineOfSight(a: number, b: number): boolean {
    const { cols } = this.grid;
    const ax = (a % cols) + 0.5;
    const az = Math.floor(a / cols) + 0.5;
    const bx = (b % cols) + 0.5;
    const bz = Math.floor(b / cols) + 0.5;
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(dist / 0.25);
    const nx = dist > 0 ? -(bz - az) / dist : 0;
    const nz = dist > 0 ? (bx - ax) / dist : 0;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      // Check a corridor about one character wide.
      for (const o of [-0.35, 0, 0.35]) {
        if (!this.walkable(Math.floor(x + nx * o), Math.floor(z + nz * o))) return false;
      }
    }
    return true;
  }

  private push(n: number) {
    const heap = this.heap;
    const f = this.f;
    let i = this.heapSize++;
    heap[i] = n;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f[heap[p]!]! <= f[n]!) break;
      heap[i] = heap[p]!;
      heap[p] = n;
      i = p;
    }
  }

  private pop(): number {
    const heap = this.heap;
    const f = this.f;
    const top = heap[0]!;
    const last = heap[--this.heapSize]!;
    if (this.heapSize > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.heapSize && f[heap[l]!]! < f[heap[m]!]!) m = l;
        if (r < this.heapSize && f[heap[r]!]! < f[heap[m]!]!) m = r;
        if (m === i) break;
        const tmp = heap[i]!;
        heap[i] = heap[m]!;
        heap[m] = tmp;
        i = m;
      }
    }
    return top;
  }
}

/**
 * Round corners: replace each interior waypoint by two points 0.35 before/after it, then sample a
 * uniform Catmull-Rom spline every ~0.12 units and accumulate lengths for constant-speed following.
 */
export function smooth(flat: number[]): FollowPath {
  const raw: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) {
    const x = flat[i] as number;
    const z = flat[i + 1] as number;
    const prev = raw[raw.length - 1];
    if (!prev || Math.hypot(prev[0] - x, prev[1] - z) > 0.05) raw.push([x, z]);
  }
  if (raw.length === 1) raw.push([raw[0]![0], raw[0]![1]]);

  const pts: [number, number][] = [raw[0]!];
  for (let i = 1; i < raw.length - 1; i++) {
    const [px, pz] = raw[i - 1]!;
    const [cx, cz] = raw[i]!;
    const [nx, nz] = raw[i + 1]!;
    const lin = Math.hypot(cx - px, cz - pz);
    const lout = Math.hypot(nx - cx, nz - cz);
    const r = Math.min(0.35, lin / 2.5, lout / 2.5);
    if (r < 0.05) {
      pts.push([cx, cz]);
      continue;
    }
    pts.push([cx - ((cx - px) / lin) * r, cz - ((cz - pz) / lin) * r]);
    pts.push([cx + ((nx - cx) / lout) * r, cz + ((nz - cz) / lout) * r]);
  }
  pts.push(raw[raw.length - 1]!);

  const xs: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(segLen / 0.12));
    for (let s = 0; s < n; s++) {
      const t = s / n;
      xs.push(catmull(p0[0], p1[0], p2[0], p3[0], t));
      zs.push(catmull(p0[1], p1[1], p2[1], p3[1], t));
    }
  }
  const end = pts[pts.length - 1]!;
  xs.push(end[0]);
  zs.push(end[1]);

  const cum = new Float32Array(xs.length);
  for (let i = 1; i < xs.length; i++) {
    cum[i] = cum[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, zs[i]! - zs[i - 1]!);
  }
  return { xs: Float32Array.from(xs), zs: Float32Array.from(zs), cum, length: cum[cum.length - 1] ?? 0 };
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/**
 * Position and tangent at arc length `s`. `cursor` is the last sample index (monotonic walks are
 * O(1) per frame). Returns the new cursor.
 */
export function samplePath(path: FollowPath, s: number, cursor: number, out: { x: number; z: number; dx: number; dz: number }): number {
  const { xs, zs, cum } = path;
  const last = xs.length - 1;
  let i = Math.min(Math.max(0, cursor), last);
  while (i < last && cum[i + 1]! < s) i++;
  while (i > 0 && cum[i]! > s) i--;
  if (i >= last) {
    out.x = xs[last]!;
    out.z = zs[last]!;
    const j = Math.max(0, last - 1);
    out.dx = xs[last]! - xs[j]!;
    out.dz = zs[last]! - zs[j]!;
    return last;
  }
  const seg = cum[i + 1]! - cum[i]!;
  const t = seg > 0 ? (s - cum[i]!) / seg : 0;
  out.dx = xs[i + 1]! - xs[i]!;
  out.dz = zs[i + 1]! - zs[i]!;
  out.x = xs[i]! + out.dx * t;
  out.z = zs[i]! + out.dz * t;
  return i;
}
