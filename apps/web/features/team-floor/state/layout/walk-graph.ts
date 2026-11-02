import { insidePolygon, lineClear, obstacleDistance, pointSegment, type Obstacle } from '../layout';
import type { FloorTemplate } from '../template';

/**
 * Walking graph for floors made at runtime (published layout_json plans and GLB seat maps): a grid
 * over the walkable floor plus a node pair on both sides of every door, joined by clear straight
 * lines. Same format as the hand-made template graphs, so pathfinding (state/pathfinding.ts) is
 * unchanged. Walls and furniture are looked up in 2 m buckets to keep big plans fast.
 */

type Seg = [number, number, number, number];
type TemplateObstacle = FloorTemplate['obstacles'][number];
type GraphOut = FloorTemplate['graph'];

const RAD = Math.PI / 180;
const BUCKET = 2;
const NODE_CLEARANCE = 0.32;
const EDGE_CLEARANCE = 0.2;

export function toObstacle(o: TemplateObstacle): Obstacle {
  return o.kind === 'circle'
    ? { kind: 'circle', x: o.pos[0], z: o.pos[1], hw: o.r, hd: o.r, cos: 1, sin: 0 }
    : { kind: 'rect', x: o.pos[0], z: o.pos[1], hw: o.size[0] / 2, hd: o.size[1] / 2, cos: Math.cos(-o.facing * RAD), sin: Math.sin(-o.facing * RAD) };
}

/** Wall segments that block walking (openings other than windows removed). */
export function wallSolids(walls: FloorTemplate['walls']): Seg[] {
  const out: Seg[] = [];
  for (const w of walls) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    if (len < 1e-6) continue;
    const ux = (w.b[0] - w.a[0]) / len;
    const uz = (w.b[1] - w.a[1]) / len;
    let cursor = 0;
    const cuts = w.openings.filter((o) => o.kind !== 'window').sort((p, q) => p.from - q.from);
    for (const o of [...cuts, { from: len, to: len }]) {
      if (o.from > cursor) out.push([w.a[0] + ux * cursor, w.a[1] + uz * cursor, w.a[0] + ux * o.from, w.a[1] + uz * o.from]);
      cursor = Math.max(cursor, o.to);
    }
  }
  return out;
}

class Buckets<T> {
  private readonly cells = new Map<string, T[]>();
  add(item: T, x0: number, z0: number, x1: number, z1: number) {
    for (let i = Math.floor(x0 / BUCKET); i <= Math.floor(x1 / BUCKET); i++) {
      for (let j = Math.floor(z0 / BUCKET); j <= Math.floor(z1 / BUCKET); j++) {
        const k = `${i},${j}`;
        const list = this.cells.get(k);
        if (list) list.push(item);
        else this.cells.set(k, [item]);
      }
    }
  }
  query(x0: number, z0: number, x1: number, z1: number): T[] {
    const out = new Set<T>();
    for (let i = Math.floor(x0 / BUCKET); i <= Math.floor(x1 / BUCKET); i++) {
      for (let j = Math.floor(z0 / BUCKET); j <= Math.floor(z1 / BUCKET); j++) {
        for (const item of this.cells.get(`${i},${j}`) ?? []) out.add(item);
      }
    }
    return [...out];
  }
}

export interface GraphInput {
  footprint: [number, number][];
  walls: FloorTemplate['walls'];
  obstacles: TemplateObstacle[];
  /** Points that must be nodes, with the ids of nodes they must link to (door sides, the entrance). */
  extra: { id: string; pos: [number, number]; link?: string[] }[];
}

export function buildWalkGraph(input: GraphInput): GraphOut {
  const segs = wallSolids(input.walls);
  const obs = input.obstacles.map(toObstacle);
  const wallIndex = new Buckets<Seg>();
  for (const s of segs) wallIndex.add(s, Math.min(s[0], s[2]) - 1, Math.min(s[1], s[3]) - 1, Math.max(s[0], s[2]) + 1, Math.max(s[1], s[3]) + 1);
  const obsIndex = new Buckets<Obstacle>();
  for (const o of obs) {
    const r = Math.max(o.hw, o.hd) * 1.42 + 0.5;
    obsIndex.add(o, o.x - r, o.z - r, o.x + r, o.z + r);
  }
  const near = (ax: number, az: number, bx: number, bz: number) => {
    const x0 = Math.min(ax, bx) - 0.6;
    const z0 = Math.min(az, bz) - 0.6;
    const x1 = Math.max(ax, bx) + 0.6;
    const z1 = Math.max(az, bz) + 0.6;
    return { walls: wallIndex.query(x0, z0, x1, z1), obstacles: obsIndex.query(x0, z0, x1, z1) };
  };
  const clear = (ax: number, az: number, bx: number, bz: number, c = EDGE_CLEARANCE) => {
    const n = near(ax, az, bx, bz);
    return lineClear(ax, az, bx, bz, n.walls, n.obstacles, c);
  };
  const free = (x: number, z: number) => {
    const n = near(x, z, x, z);
    return !n.walls.some(([ax, az, bx, bz]) => pointSegment(x, z, ax, az, bx, bz) < NODE_CLEARANCE) && !n.obstacles.some((o) => obstacleDistance(o, x, z) < NODE_CLEARANCE);
  };

  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [x, z] of input.footprint) {
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
  }
  const area = Math.max(1, (x1 - x0) * (z1 - z0));
  // ~1600 cells at most; doors get their own nodes, so a coarse grid on huge floors still connects.
  const step = Math.min(2, Math.max(0.8, Math.sqrt(area / 1600)));
  const cols = Math.max(1, Math.floor((x1 - x0) / step));
  const rows = Math.max(1, Math.floor((z1 - z0) / step));
  const ox = x0 + (x1 - x0 - (cols - 1) * step) / 2;
  const oz = z0 + (z1 - z0 - (rows - 1) * step) / 2;

  const nodes: { id: string; pos: [number, number] }[] = [];
  const edges: [string, string][] = [];
  const grid = new Map<string, { id: string; x: number; z: number }>();
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = ox + i * step;
      const z = oz + j * step;
      if (!insidePolygon(x, z, input.footprint) || !free(x, z)) continue;
      const id = `g${i}_${j}`;
      grid.set(`${i},${j}`, { id, x, z });
      nodes.push({ id, pos: [round(x), round(z)] });
    }
  }
  const NEIGHBOURS: [number, number][] = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = grid.get(`${i},${j}`);
      if (!a) continue;
      for (const [di, dj] of NEIGHBOURS) {
        const b = grid.get(`${i + di},${j + dj}`);
        if (b && clear(a.x, a.z, b.x, b.z)) edges.push([a.id, b.id]);
      }
    }
  }

  const gridNodes = [...grid.values()];
  const reach = step * 2.6;
  for (const e of input.extra) {
    nodes.push({ id: e.id, pos: [round(e.pos[0]), round(e.pos[1])] });
    for (const id of e.link ?? []) edges.push([e.id, id]);
    const [ex, ez] = e.pos;
    const ranked = gridNodes
      .map((n) => ({ n, d: Math.hypot(n.x - ex, n.z - ez) }))
      .filter((c) => c.d <= reach)
      .sort((a, b) => a.d - b.d);
    let linked = 0;
    for (const { n } of ranked) {
      if (linked >= 4) break;
      if (clear(ex, ez, n.x, n.z, 0.12)) {
        edges.push([e.id, n.id]);
        linked++;
      }
    }
  }
  // Always at least two nodes (the schema needs a graph even for a tiny or fully furnished floor).
  if (nodes.length < 2) {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    nodes.push({ id: 'c0', pos: [round(cx - 0.5), round(cz)] }, { id: 'c1', pos: [round(cx + 0.5), round(cz)] });
    edges.push(['c0', 'c1']);
  }
  return { nodes, edges };
}

/** Finds the nearest node with a clear line (walls and furniture) to a point, else the nearest node. */
export function nodeFinder(graph: GraphOut, walls: FloorTemplate['walls'], obstacles: TemplateObstacle[]): (x: number, z: number) => string {
  const segs = wallSolids(walls);
  const obs = obstacles.map(toObstacle);
  return (x, z) => {
    const ranked = graph.nodes.map((n) => ({ n, d: Math.hypot(n.pos[0] - x, n.pos[1] - z) })).sort((a, b) => a.d - b.d);
    for (const { n } of ranked.slice(0, 10)) {
      const local = obs.filter((o) => Math.hypot(o.x - (x + n.pos[0]) / 2, o.z - (z + n.pos[1]) / 2) < Math.max(o.hw, o.hd) + 3);
      if (lineClear(x, z, n.pos[0], n.pos[1], segs, local, 0.1)) return n.id;
    }
    return ranked[0]?.n.id ?? graph.nodes[0]!.id;
  };
}

export const round = (v: number) => Math.round(v * 1000) / 1000;
