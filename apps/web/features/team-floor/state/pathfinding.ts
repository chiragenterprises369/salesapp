import { obstacleDistance, pointSegment, type FloorLayout } from './layout';

/**
 * Pathfinding on the template's walking graph (SPEC 12.1 item 4): A* between graph nodes, with
 * the start and end attached to their nearest visible node, string pulling where the straight line
 * is clear, and Catmull-Rom smoothing. No three.js: plain arrays.
 */

export interface FollowPath {
  xs: Float32Array;
  zs: Float32Array;
  /** Cumulative length at each sample. */
  cum: Float32Array;
  length: number;
}

const CACHE_MAX = 400;
const CLEARANCE = 0.22;

export class PathFinder {
  private readonly layout: FloorLayout;
  private readonly cache = new Map<string, number[] | null>();

  constructor(layout: FloorLayout) {
    this.layout = layout;
  }

  /** True when a person can walk the straight segment (walls and furniture keep their distance). */
  clear(ax: number, az: number, bx: number, bz: number, clearance = CLEARANCE): boolean {
    for (const [wx, wz, vx, vz] of this.layout.walls) {
      if (segmentsCross(ax, az, bx, bz, wx, wz, vx, vz)) return false;
      if (pointSegment(wx, wz, ax, az, bx, bz) < clearance || pointSegment(vx, vz, ax, az, bx, bz) < clearance) return false;
    }
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / 0.12));
    for (const o of this.layout.obstacles) {
      // Ignore obstacles that contain an endpoint (the person's own desk or chair corner).
      if (obstacleDistance(o, ax, az) < 0.05 || obstacleDistance(o, bx, bz) < 0.05) continue;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        if (obstacleDistance(o, ax + (bx - ax) * t, az + (bz - az) * t) < clearance) return false;
      }
    }
    return true;
  }

  /** Nearest graph node with a clear line from (x, z); falls back to the nearest node. */
  nearestNode(x: number, z: number, hint?: string): number {
    const { graph, nodeIndex } = this.layout;
    if (hint) {
      const i = nodeIndex.get(hint);
      if (i !== undefined) return i;
    }
    const ranked = graph.map((n, i) => ({ i, d: Math.hypot(n.x - x, n.z - z) })).sort((a, b) => a.d - b.d);
    for (const { i } of ranked.slice(0, 8)) {
      const n = graph[i]!;
      if (this.clear(x, z, n.x, n.z, 0.12)) return i;
    }
    return ranked[0]?.i ?? 0;
  }

  /** Smoothed path between two world points, or null when unreachable. */
  route(fromX: number, fromZ: number, toX: number, toZ: number, opts: { fromNode?: string; toNode?: string } = {}): FollowPath | null {
    if (Math.hypot(toX - fromX, toZ - fromZ) < 0.05) return null;
    if (Math.hypot(toX - fromX, toZ - fromZ) < 2.5 && this.clear(fromX, fromZ, toX, toZ)) return smooth([fromX, fromZ, toX, toZ]);
    const a = this.nearestNode(fromX, fromZ, opts.fromNode);
    const b = this.nearestNode(toX, toZ, opts.toNode);
    const key = `${a}:${b}`;
    let nodes = this.cache.get(key);
    if (nodes === undefined) {
      nodes = a === b ? [a] : this.search(a, b);
      if (this.cache.size >= CACHE_MAX) {
        const first = this.cache.keys().next().value;
        if (first !== undefined) this.cache.delete(first);
      }
      this.cache.set(key, nodes);
    }
    if (!nodes) return null;
    const pts: [number, number][] = [[fromX, fromZ]];
    for (const i of nodes) {
      const n = this.layout.graph[i]!;
      pts.push([n.x, n.z]);
    }
    pts.push([toX, toZ]);
    const pulled = this.pull(pts);
    const flat: number[] = [];
    for (const [x, z] of pulled) flat.push(x, z);
    return smooth(flat);
  }

  /** Drop waypoints that have a clear line to a later one (string pulling). */
  private pull(pts: [number, number][]): [number, number][] {
    if (pts.length <= 2) return pts;
    const out: [number, number][] = [pts[0]!];
    let anchor = 0;
    for (let k = 2; k < pts.length; k++) {
      const a = pts[anchor]!;
      const b = pts[k]!;
      if (!this.clear(a[0], a[1], b[0], b[1])) {
        out.push(pts[k - 1]!);
        anchor = k - 1;
      }
    }
    out.push(pts[pts.length - 1]!);
    return out;
  }

  private search(start: number, goal: number): number[] | null {
    const g = this.layout.graph;
    const n = g.length;
    const dist = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    const goalNode = g[goal]!;
    const h = (i: number) => Math.hypot(g[i]!.x - goalNode.x, g[i]!.z - goalNode.z);
    dist[start] = 0;
    const open = new Set<number>([start]);
    while (open.size) {
      let cur = -1;
      let best = Infinity;
      for (const i of open) {
        const f = dist[i]! + h(i);
        if (f < best) {
          best = f;
          cur = i;
        }
      }
      if (cur === goal) break;
      open.delete(cur);
      done[cur] = 1;
      const node = g[cur]!;
      for (let k = 0; k < node.next.length; k++) {
        const nb = node.next[k]!;
        if (done[nb]) continue;
        const d = dist[cur]! + node.cost[k]!;
        if (d < dist[nb]!) {
          dist[nb] = d;
          came[nb] = cur;
          open.add(nb);
        }
      }
    }
    if (!Number.isFinite(dist[goal]!)) return null;
    const out: number[] = [];
    for (let c = goal; c !== -1; c = came[c]!) out.push(c);
    return out.reverse();
  }
}

function segmentsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
  return o(ax, az, bx, bz, cx, cz) * o(ax, az, bx, bz, dx, dz) < 0 && o(cx, cz, dx, dz, ax, az) * o(cx, cz, dx, dz, bx, bz) < 0;
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
    const r = Math.min(0.45, lin / 2.5, lout / 2.5);
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
