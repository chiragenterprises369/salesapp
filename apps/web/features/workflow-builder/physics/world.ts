import { nodeSize, snap, sourceHandlePoint, targetHandlePoint } from '../lib/geometry';
import type { FlowNode } from '../lib/graph';
import { Rope } from './rope';
import { Spring } from './spring';

/**
 * One animation loop for the whole canvas: node cards (lift, tilt, inertia, snap overshoot,
 * neighbour repulsion), verlet ropes and run packets. Everything is written straight to the DOM
 * (transforms, path `d`), never through React state. React Flow positions only change at the end
 * of a gesture (the snapped position); the visual difference is an offset spring on the card.
 * The loop stops (no rAF) as soon as every spring, rope and packet is at rest.
 */

const STEP = 1 / 60;
const MAX_TILT = 8;
const LIFT_PX = 6;
const HOVER_PX = 2;
const LIFT_SCALE = 0.03;
const REPEL_MARGIN = 36;
const REPEL_MAX = 26;
const THROW_TIME = 0.09; // seconds of inertia carried past the release point
const THROW_MAX = 140;

interface NodeSource {
  getState(): { nodes: FlowNode[] };
  subscribe(listener: (state: { nodes: FlowNode[] }, prev: { nodes: FlowNode[] }) => void): () => void;
}

export interface BodyElements {
  body: HTMLElement;
  shadow: HTMLElement;
  raised: HTMLElement;
  lifted: HTMLElement;
}

class Body {
  els: BodyElements | null = null;
  ox = new Spring(260, 20);
  oy = new Spring(260, 20);
  lift = new Spring(420, 36, 0, 0.002);
  hover = new Spring(520, 42, 0, 0.002);
  rx = new Spring(300, 26);
  ry = new Spring(300, 26);
  rz = new Spring(300, 26);
  dragging = false;
  lastX = NaN;
  lastY = NaN;
  vx = 0;
  vy = 0;
  dirty = true;

  springs() {
    return [this.ox, this.oy, this.lift, this.hover, this.rx, this.ry, this.rz];
  }
}

interface RopeEntry {
  source: string;
  target: string;
  sourceHandle: string;
  rope: Rope;
  els: { main: SVGPathElement; shadow: SVGPathElement; hit: SVGPathElement } | null;
  needsReset: boolean;
  drawn: boolean;
}

interface PacketEls {
  path: SVGPathElement;
  dot: SVGCircleElement;
  halo: SVGCircleElement;
}

export class PhysicsWorld {
  /** Rope + drag physics (off in flat mode and with reduced motion). */
  physics = true;
  /** Any animation at all (off with reduced motion). */
  motion = true;

  private bodies = new Map<string, Body>();
  private ropes = new Map<string, RopeEntry>();
  private packetEls = new Map<string, PacketEls>();
  private packets = new Map<string, { t0: number; dur: number }>();
  private nodes = new Map<string, FlowNode>();
  private raf = 0;
  private last = 0;
  private acc = 0;
  private statusEl: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private dragging = 0;

  constructor(private source: NodeSource) {
    this.syncNodes(source.getState().nodes);
  }

  /** Start following the store (call from an effect; StrictMode may attach/detach twice). */
  attach() {
    this.unsubscribe?.();
    this.syncNodes(this.source.getState().nodes);
    this.unsubscribe = this.source.subscribe((s, prev) => {
      if (s.nodes !== prev.nodes) this.syncNodes(s.nodes);
    });
  }

  detach() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  configure(opts: { physics: boolean; motion: boolean }) {
    const changed = opts.physics !== this.physics || opts.motion !== this.motion;
    this.physics = opts.physics;
    this.motion = opts.motion;
    if (!changed) return;
    for (const b of this.bodies.values()) {
      for (const s of [b.ox, b.oy, b.rx, b.ry, b.rz]) s.set(0);
      if (!this.motion) {
        b.lift.set(b.dragging ? 1 : 0);
        b.hover.set(0);
      }
      b.dirty = true;
      this.renderBody(b);
    }
    if (!this.motion) {
      for (const id of this.packets.keys()) this.hidePacket(id);
      this.packets.clear();
    }
    this.wake();
  }

  setStatusElement(el: HTMLElement | null) {
    this.statusEl = el;
    el?.setAttribute('data-physics', this.raf ? 'running' : 'idle');
  }

  // ---------------------------------------------------------------- nodes

  private syncNodes(list: FlowNode[]) {
    let moved = false;
    const next = new Map<string, FlowNode>();
    for (const n of list) {
      const old = this.nodes.get(n.id);
      if (!old || old.position.x !== n.position.x || old.position.y !== n.position.y || old.data.config !== n.data.config) moved = true;
      next.set(n.id, n);
    }
    if (next.size !== this.nodes.size) moved = true;
    this.nodes = next;
    if (moved) {
      for (const r of this.ropes.values()) r.rope.restSteps = 0;
      this.wake();
    }
  }

  registerBody(id: string, els: BodyElements) {
    let b = this.bodies.get(id);
    if (!b) {
      b = new Body();
      this.bodies.set(id, b);
    }
    b.els = els;
    b.dirty = true;
    this.renderBody(b);
  }

  unregisterBody(id: string) {
    const b = this.bodies.get(id);
    if (b) b.els = null;
    this.bodies.delete(id);
  }

  setHover(id: string, hovered: boolean) {
    const b = this.bodies.get(id);
    if (!b) return;
    b.hover.target = hovered ? 1 : 0;
    if (!this.motion) b.hover.set(b.hover.target);
    b.dirty = true;
    this.renderBody(b);
    this.wake();
  }

  startDrag(ids: string[]) {
    for (const id of ids) {
      const b = this.bodies.get(id);
      const n = this.nodes.get(id);
      if (!b || !n || b.dragging) continue;
      b.dragging = true;
      this.dragging++;
      b.lastX = n.position.x;
      b.lastY = n.position.y;
      b.vx = 0;
      b.vy = 0;
      b.lift.target = 1;
      if (!this.motion) b.lift.set(1);
      b.dirty = true;
    }
    this.wake();
  }

  /**
   * End a drag. Returns the final (snapped) positions. With physics on, the card keeps its release
   * momentum: React Flow gets the snapped position at once, the card glides there on an offset
   * spring (inertia + slight overshoot), and the neighbours settle back.
   */
  endDrag(ids: string[]): Map<string, { x: number; y: number }> {
    const finals = new Map<string, { x: number; y: number }>();
    for (const id of ids) {
      const b = this.bodies.get(id);
      const n = this.nodes.get(id);
      if (!n) continue;
      const pos = n.position;
      if (!b) {
        finals.set(id, { x: snap(pos.x), y: snap(pos.y) });
        continue;
      }
      if (b.dragging) this.dragging = Math.max(0, this.dragging - 1);
      b.dragging = false;
      let tx = 0;
      let ty = 0;
      if (this.physics) {
        tx = b.vx * THROW_TIME;
        ty = b.vy * THROW_TIME;
        const len = Math.hypot(tx, ty);
        if (len > THROW_MAX) {
          tx = (tx / len) * THROW_MAX;
          ty = (ty / len) * THROW_MAX;
        }
      }
      const final = { x: snap(pos.x + tx), y: snap(pos.y + ty) };
      finals.set(id, final);
      if (this.physics) {
        b.ox.x = pos.x - final.x;
        b.oy.x = pos.y - final.y;
        b.ox.v = b.vx * 0.35;
        b.oy.v = b.vy * 0.35;
        b.ox.target = 0;
        b.oy.target = 0;
      }
      b.lift.target = 0;
      b.rx.target = 0;
      b.ry.target = 0;
      b.rz.target = 0;
      if (!this.motion) for (const s of b.springs()) s.set(s.target);
      b.dirty = true;
      this.renderBody(b);
    }
    for (const b of this.bodies.values()) {
      if (b.dragging) continue;
      b.ox.target = 0;
      b.oy.target = 0;
    }
    this.wake();
    return finals;
  }

  /**
   * Animate nodes from their previous positions to the current store positions (auto-layout,
   * undo/redo, keyboard nudges). Call right after the store update.
   */
  glide(previous: Map<string, { x: number; y: number }>) {
    if (!this.physics || !this.motion) return;
    for (const [id, prev] of previous) {
      const b = this.bodies.get(id);
      const n = this.nodes.get(id);
      if (!b || !n) continue;
      const dx = prev.x - n.position.x;
      const dy = prev.y - n.position.y;
      if (dx === 0 && dy === 0) continue;
      b.ox.x += dx;
      b.oy.x += dy;
      b.ox.target = 0;
      b.oy.target = 0;
      b.dirty = true;
      this.renderBody(b);
    }
    this.wake();
  }

  // ---------------------------------------------------------------- ropes

  registerRope(id: string, meta: { source: string; target: string; sourceHandle: string }, els: RopeEntry['els']) {
    const entry: RopeEntry = { ...meta, rope: new Rope(), els, needsReset: true, drawn: false };
    this.ropes.set(id, entry);
    this.resetRope(entry);
    this.wake();
  }

  unregisterRope(id: string) {
    this.ropes.delete(id);
  }

  ropeCount() {
    return this.ropes.size;
  }

  private resetRope(r: RopeEntry) {
    const ends = this.ropeEnds(r);
    if (!ends) return;
    r.rope.reset(ends[0], ends[1], ends[2], ends[3]);
    r.needsReset = false;
    this.drawRope(r);
  }

  private drawRope(r: RopeEntry) {
    if (!r.els) return;
    const d = r.rope.path();
    r.els.main.setAttribute('d', d);
    r.els.shadow.setAttribute('d', d);
    r.els.hit.setAttribute('d', d);
    r.drawn = true;
  }

  /** Visual handle positions (store position + card offset/lift/hover). */
  private ropeEnds(r: RopeEntry): [number, number, number, number] | null {
    const s = this.nodes.get(r.source);
    const t = this.nodes.get(r.target);
    if (!s || !t) return null;
    const sp = sourceHandlePoint(s.type, s.data.config, r.sourceHandle);
    const tp = targetHandlePoint(t.type, t.data.config) ?? { x: nodeSize(t.type, t.data.config).w / 2, y: 0 };
    const a = this.visualPoint(s, sp.x, sp.y);
    const b = this.visualPoint(t, tp.x, tp.y);
    return [a.x, a.y, b.x, b.y];
  }

  private visualPoint(n: FlowNode, lx: number, ly: number) {
    const b = this.bodies.get(n.id);
    if (!b) return { x: n.position.x + lx, y: n.position.y + ly };
    const { w, h } = nodeSize(n.type, n.data.config);
    const s = 1 + b.lift.x * LIFT_SCALE;
    return {
      x: n.position.x + w / 2 + (lx - w / 2) * s + b.ox.x,
      y: n.position.y + h / 2 + (ly - h / 2) * s + b.oy.x - b.lift.x * LIFT_PX - b.hover.x * HOVER_PX,
    };
  }

  // ---------------------------------------------------------------- packets

  registerPacket(edgeId: string, els: PacketEls) {
    this.packetEls.set(edgeId, els);
  }

  unregisterPacket(edgeId: string) {
    this.packetEls.delete(edgeId);
    this.packets.delete(edgeId);
  }

  /** Animate a data packet along an edge (no-op with reduced motion). */
  sendPacket(edgeId: string, durationMs: number) {
    if (!this.motion || !this.packetEls.has(edgeId)) return;
    this.packets.set(edgeId, { t0: performance.now(), dur: durationMs });
    this.wake();
  }

  private hidePacket(edgeId: string) {
    const els = this.packetEls.get(edgeId);
    if (!els) return;
    els.dot.style.opacity = '0';
    els.halo.style.opacity = '0';
  }

  // ---------------------------------------------------------------- loop

  wake() {
    if (this.raf || typeof window === 'undefined') return;
    this.last = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame(this.tick);
    this.statusEl?.setAttribute('data-physics', 'running');
  }

  private tick = (now: number) => {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;

    // Pointer velocity from React Flow positions (smoothed), then tilt targets.
    if (this.dragging > 0) {
      const k = 1 - Math.exp(-dt / 0.06);
      for (const [id, b] of this.bodies) {
        if (!b.dragging) continue;
        const n = this.nodes.get(id);
        if (!n) continue;
        if (dt > 0) {
          const ix = (n.position.x - b.lastX) / dt;
          const iy = (n.position.y - b.lastY) / dt;
          b.vx += (ix - b.vx) * k;
          b.vy += (iy - b.vy) * k;
        }
        b.lastX = n.position.x;
        b.lastY = n.position.y;
        if (this.physics) {
          let ry = b.vx * 0.012;
          let rx = -b.vy * 0.012;
          const mag = Math.hypot(rx, ry);
          if (mag > MAX_TILT) {
            rx = (rx / mag) * MAX_TILT;
            ry = (ry / mag) * MAX_TILT;
          }
          b.rx.target = rx;
          b.ry.target = ry;
          b.rz.target = Math.max(-3, Math.min(3, b.vx * 0.004));
        }
        b.dirty = true;
      }
      if (this.physics) this.applyRepulsion();
    }

    this.acc += dt;
    let steps = 0;
    let bodiesActive = false;
    let ropesActive = false;
    while (this.acc >= STEP && steps < 4) {
      bodiesActive = this.stepBodies(STEP) || bodiesActive;
      ropesActive = this.stepRopes() || ropesActive;
      this.acc -= STEP;
      steps++;
    }
    if (steps === 4) this.acc = 0;
    if (steps === 0) {
      // Frame faster than the fixed step: still report activity so the loop keeps going.
      bodiesActive = [...this.bodies.values()].some((b) => b.dragging || b.springs().some((s) => !s.resting));
      ropesActive = [...this.ropes.values()].some((r) => !r.rope.atRest || r.needsReset);
    }

    for (const b of this.bodies.values()) if (b.dirty) this.renderBody(b);
    for (const r of this.ropes.values()) if (!r.rope.atRest || !r.drawn) this.drawRope(r);
    const packetsActive = this.renderPackets(now);

    if (this.dragging > 0 || bodiesActive || ropesActive || packetsActive) {
      this.raf = requestAnimationFrame(this.tick);
    } else {
      this.raf = 0;
      this.statusEl?.setAttribute('data-physics', 'idle');
    }
  };

  private applyRepulsion() {
    const dragged: Array<{ cx: number; cy: number; w: number; h: number }> = [];
    for (const [id, b] of this.bodies) {
      if (!b.dragging) continue;
      const n = this.nodes.get(id);
      if (!n) continue;
      const { w, h } = nodeSize(n.type, n.data.config);
      dragged.push({ cx: n.position.x + w / 2, cy: n.position.y + h / 2, w, h });
    }
    for (const [id, b] of this.bodies) {
      if (b.dragging) continue;
      const n = this.nodes.get(id);
      if (!n) continue;
      const { w, h } = nodeSize(n.type, n.data.config);
      const cx = n.position.x + w / 2;
      const cy = n.position.y + h / 2;
      let px = 0;
      let py = 0;
      for (const d of dragged) {
        const dx = cx - d.cx;
        const dy = cy - d.cy;
        const ox = d.w / 2 + w / 2 + REPEL_MARGIN - Math.abs(dx);
        const oy = d.h / 2 + h / 2 + REPEL_MARGIN - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        const len = Math.hypot(dx, dy);
        const ux = len > 0.001 ? dx / len : 0;
        const uy = len > 0.001 ? dy / len : 1;
        const strength = Math.min(1, Math.min(ox, oy) / (REPEL_MARGIN * 2)) * REPEL_MAX;
        px += ux * strength;
        py += uy * strength;
      }
      const m = Math.hypot(px, py);
      if (m > REPEL_MAX) {
        px = (px / m) * REPEL_MAX;
        py = (py / m) * REPEL_MAX;
      }
      if (b.ox.target !== px || b.oy.target !== py) {
        b.ox.target = px;
        b.oy.target = py;
        b.dirty = true;
      }
    }
  }

  private stepBodies(h: number): boolean {
    let active = false;
    for (const b of this.bodies.values()) {
      let moving = false;
      for (const s of b.springs()) moving = s.step(h) || moving;
      if (moving) {
        b.dirty = true;
        active = true;
      }
      if (b.dragging) active = true;
    }
    return active;
  }

  private stepRopes(): boolean {
    if (!this.physics) return false;
    let active = false;
    for (const r of this.ropes.values()) {
      if (r.needsReset) {
        this.resetRope(r);
        if (r.needsReset) continue;
      }
      const ends = this.ropeEnds(r);
      if (!ends) continue;
      // Endpoint teleports (undo, paste) re-seat the rope instead of whipping it across the canvas.
      const c = r.rope.cur;
      const jump = Math.max(Math.abs(c[0]! - ends[0]), Math.abs(c[1]! - ends[1]), Math.abs(c[22]! - ends[2]), Math.abs(c[23]! - ends[3]));
      if (jump > 400) {
        r.rope.reset(ends[0], ends[1], ends[2], ends[3]);
        r.drawn = false;
        continue;
      }
      r.rope.step(ends[0], ends[1], ends[2], ends[3]);
      if (!r.rope.atRest) active = true;
    }
    return active;
  }

  private renderBody(b: Body) {
    b.dirty = false;
    const els = b.els;
    if (!els) return;
    const lift = b.lift.x;
    const hov = b.hover.x;
    const ox = b.ox.x;
    const oy = b.oy.x;
    const ty = oy - lift * LIFT_PX - hov * HOVER_PX;
    const rx = b.rx.x;
    const ry = b.ry.x;
    const rz = b.rz.x;
    const identity = Math.abs(ox) < 0.01 && Math.abs(ty) < 0.01 && Math.abs(rx) < 0.01 && Math.abs(ry) < 0.01 && Math.abs(rz) < 0.01 && lift < 0.001;
    els.body.style.transform = identity
      ? ''
      : `translate3d(${ox.toFixed(2)}px,${ty.toFixed(2)}px,0) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) scale(${(1 + lift * LIFT_SCALE).toFixed(4)})`;
    els.shadow.style.transform = Math.abs(ox) < 0.01 && Math.abs(oy) < 0.01 ? '' : `translate3d(${ox.toFixed(2)}px,${oy.toFixed(2)}px,0)`;
    els.raised.style.opacity = (hov * (1 - lift)).toFixed(3);
    els.lifted.style.opacity = lift.toFixed(3);
  }

  private renderPackets(now: number): boolean {
    let active = false;
    for (const [edgeId, p] of this.packets) {
      const els = this.packetEls.get(edgeId);
      if (!els) {
        this.packets.delete(edgeId);
        continue;
      }
      const t = (now - p.t0) / p.dur;
      if (t >= 1) {
        this.hidePacket(edgeId);
        this.packets.delete(edgeId);
        continue;
      }
      active = true;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const len = els.path.getTotalLength();
      const pt = els.path.getPointAtLength(len * Math.max(0, e));
      const fade = Math.min(1, t * 8, (1 - t) * 8);
      for (const c of [els.dot, els.halo]) {
        c.setAttribute('cx', pt.x.toFixed(1));
        c.setAttribute('cy', pt.y.toFixed(1));
      }
      els.dot.style.opacity = fade.toFixed(3);
      els.halo.style.opacity = (fade * 0.28).toFixed(3);
    }
    return active;
  }
}
