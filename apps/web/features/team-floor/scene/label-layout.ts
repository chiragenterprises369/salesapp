/**
 * Collision-avoiding label placement (SPEC 12.1 item 5). Pure: screen-space rectangles in CSS px.
 *
 * - Bubbles ("Needs you", call outcomes such as "Missed", the hub queue counter) are placed first in
 *   their own lane above the name-tag lane, so they never fight name tags for the spot over a head.
 * - Name tags follow in priority order (selected, needs you, on call, others). Each tries spots near
 *   the head; a displaced label gets a leader line back to the head. When nothing fits, the tag
 *   shrinks to the status dot plus initials, and only then is it hidden (the person stays visible).
 * - The previous spot is tried first (hysteresis), so labels do not jump while people walk.
 * The result never contains overlapping rectangles (gap included).
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LabelKind = 'tag' | 'bubble' | 'counter';
export type LabelMode = 'full' | 'compact' | 'hidden';

export interface LabelInput {
  id: string;
  kind: LabelKind;
  /** Lower = placed first. */
  priority: number;
  /** Anchor in CSS px (head top for people). */
  ax: number;
  ay: number;
  w: number;
  h: number;
  /** Compact size (tags only). */
  cw?: number;
  ch?: number;
  /** Lane offset above the anchor for bubbles (px). */
  lane?: number;
  /** Crowded floor: this tag goes straight to the compact pill (status dot plus initials). */
  compactOnly?: boolean;
}

export interface Placement extends Rect {
  id: string;
  kind: LabelKind;
  mode: LabelMode;
  /** Candidate index used (for hysteresis). */
  slot: number;
  leader: boolean;
  ax: number;
  ay: number;
}

const GAP = 3;
const EDGE = 4;

/** Candidate offsets: dx in label widths, dy in px (negative = up). Index 0 is the default spot. */
const TAG_CANDIDATES: [number, number][] = [
  [0, 0],
  [0, -7],
  [-0.62, -2],
  [0.62, -2],
  [0, -18],
  [-0.62, -14],
  [0.62, -14],
  [-1.12, -4],
  [1.12, -4],
  [0, -30],
  [-1.12, -20],
  [1.12, -20],
  [-0.62, -28],
  [0.62, -28],
  [0, -44],
  [-1.6, -10],
  [1.6, -10],
  [0, 26],
  [-0.62, 22],
  [0.62, 22],
];
const BUBBLE_CANDIDATES: [number, number][] = [
  [0, 0],
  [0, -10],
  [-0.62, -4],
  [0.62, -4],
  [0, -22],
  [-0.62, -18],
  [0.62, -18],
  [-1.1, -8],
  [1.1, -8],
  [0, -36],
  [-1.1, -28],
  [1.1, -28],
];

function hit(a: Rect, b: Rect, gap: number) {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/** Uniform grid for broad-phase overlap tests. */
class Grid {
  private readonly cell = 64;
  private readonly cells = new Map<number, Rect[]>();
  private key(cx: number, cy: number) {
    return (cx + 1024) * 4096 + (cy + 1024);
  }
  add(r: Rect) {
    const c = this.cell;
    for (let cy = Math.floor(r.y / c); cy <= Math.floor((r.y + r.h) / c); cy++) {
      for (let cx = Math.floor(r.x / c); cx <= Math.floor((r.x + r.w) / c); cx++) {
        const k = this.key(cx, cy);
        const list = this.cells.get(k);
        if (list) list.push(r);
        else this.cells.set(k, [r]);
      }
    }
  }
  collides(r: Rect, gap: number) {
    const c = this.cell;
    for (let cy = Math.floor((r.y - gap) / c); cy <= Math.floor((r.y + r.h + gap) / c); cy++) {
      for (let cx = Math.floor((r.x - gap) / c); cx <= Math.floor((r.x + r.w + gap) / c); cx++) {
        const list = this.cells.get(this.key(cx, cy));
        if (list) for (const o of list) if (hit(r, o, gap)) return true;
      }
    }
    return false;
  }
}

export interface LayoutOptions {
  width: number;
  height: number;
  /** Fixed UI rectangles labels must avoid (toolbars, legend). */
  blocked: Rect[];
  /** Small rectangles around heads: avoided when possible, never required. */
  heads: Rect[];
  previous: Map<string, Placement>;
}

export function layoutLabels(inputs: LabelInput[], opts: LayoutOptions): Placement[] {
  const placed = new Grid();
  for (const b of opts.blocked) placed.add(b);
  const heads = new Grid();
  for (const h of opts.heads) heads.add(h);
  const out: Placement[] = [];
  const inBounds = (r: Rect) => r.x >= EDGE && r.y >= EDGE && r.x + r.w <= opts.width - EDGE && r.y + r.h <= opts.height - EDGE;

  const order = [...inputs].sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.priority - b.priority || b.ay - a.ay || (a.id < b.id ? -1 : 1));

  for (const it of order) {
    const prev = opts.previous.get(it.id);
    const cands = it.kind === 'tag' ? TAG_CANDIDATES : BUBBLE_CANDIDATES;
    const modes: LabelMode[] = it.kind === 'tag' && it.cw ? (it.compactOnly ? ['compact'] : ['full', 'compact']) : ['full'];
    let done: Placement | null = null;
    for (const avoidHeads of [true, false]) {
      for (const mode of modes) {
        const w = mode === 'compact' ? (it.cw ?? it.w) : it.w;
        const h = mode === 'compact' ? (it.ch ?? it.h) : it.h;
        const baseX = it.ax - w / 2;
        const baseY = it.ay - h - 4 - (it.lane ?? 0);
        const tryAt = (slot: number): Placement | null => {
          const c = cands[slot];
          if (!c) return null;
          const r = { x: Math.round(baseX + c[0] * w), y: Math.round(baseY + c[1]), w, h };
          if (!inBounds(r) || placed.collides(r, GAP)) return null;
          if (avoidHeads && heads.collides(r, 0)) return null;
          const leader = slot !== 0 && (Math.abs(c[0]) > 0.45 || Math.abs(c[1]) > 9);
          return { ...r, id: it.id, kind: it.kind, mode, slot, leader, ax: it.ax, ay: it.ay };
        };
        if (prev && prev.mode === mode) done = tryAt(prev.slot);
        for (let s = 0; !done && s < cands.length; s++) done = tryAt(s);
        if (done) break;
      }
      if (done) break;
    }
    if (done) {
      placed.add(done);
      out.push(done);
    } else {
      out.push({ id: it.id, kind: it.kind, mode: 'hidden', slot: 0, leader: false, x: 0, y: 0, w: 0, h: 0, ax: it.ax, ay: it.ay });
    }
  }
  return out;
}

function kindRank(k: LabelKind) {
  return k === 'bubble' ? 0 : k === 'counter' ? 1 : 2;
}

/** Overlapping pairs among visible placements (used by the QA hook and tests). */
export function overlappingPairs(list: Placement[], gap = 0): [string, string][] {
  const vis = list.filter((p) => p.mode !== 'hidden');
  const out: [string, string][] = [];
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) if (hit(vis[i]!, vis[j]!, gap)) out.push([vis[i]!.id, vis[j]!.id]);
  return out;
}
