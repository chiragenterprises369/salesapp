import { formatDuration, type AttentionItem, type ChipTone } from '@vistar/shared';
import * as THREE from 'three';
import type { FloorLayout } from '../state/layout';
import type { FollowPath, PathFinder } from '../state/pathfinding';
import { samplePath } from '../state/pathfinding';
import { firstName, OUTCOME_LABEL, OUTCOME_TONE } from '../state/reducer';
import type { FloorEffect, FloorEmployee, FloorState } from '../state/types';
import type { AgentSystem } from './agents';
import { PillLabel } from './labels';
import type { LabelPalette, Look } from './look';
import type { MaterialSet } from './materials';

/**
 * Event reactions: parcels at the Lead Hub and in flight to desks, sound-wave rings for calls,
 * "Needs you" bubbles (clickable), call outcome popups and sprite name tags (medium/low tiers).
 */

const QUEUE_SLOTS = 12;
const PARCEL_CAP = 48;
const RING_CAP = 512;
const FLIGHT_SPEED = 3.4;

type ParcelPhase = 'drop' | 'queue' | 'flight' | 'land' | 'landed' | 'vanish';

interface Parcel {
  key: string;
  leadId: string;
  phase: ParcelPhase;
  t: number;
  x: number;
  y: number;
  z: number;
  slot: number;
  path: FollowPath | null;
  s: number;
  cursor: number;
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number } | null;
  ownerId: string | null;
  scale: number;
}

interface Popup {
  label: PillLabel;
  userId: string;
  t: number;
}

interface Burst {
  x: number;
  z: number;
  t: number;
  kind: 'call' | 'hub';
}

const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const sample = { x: 0, z: 0, dx: 0, dz: 0 };
const SEVERITY: Record<AttentionItem['severity'], number> = { critical: 2, warning: 1, info: 0 };
const SEVERITY_TONE: Record<AttentionItem['severity'], ChipTone> = { critical: 'red', warning: 'amber', info: 'blue' };

function ringMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aOpacity;\nvarying float vOpacity;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOpacity = aOpacity;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vOpacity;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= vOpacity;');
  };
  return m;
}

export interface BubbleHit {
  userId: string | null;
  itemIds: string[];
}

export class EffectsSystem {
  readonly group = new THREE.Group();
  private readonly layout: FloorLayout;
  private readonly paths: PathFinder;
  private readonly agents: AgentSystem;
  private palette: LabelPalette | null = null;
  private look: Look;
  private reducedMotion = false;

  private readonly parcelMesh: THREE.InstancedMesh;
  private readonly parcels: Parcel[] = [];
  private readonly counter = new PillLabel();
  private waitingCount = 0;

  private readonly ringMesh: THREE.InstancedMesh;
  private readonly ringOpacity: THREE.InstancedBufferAttribute;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly bursts: Burst[] = [];

  private readonly bubbles = new Map<string, { label: PillLabel; items: AttentionItem[]; tone: ChipTone }>();
  private readonly popups: Popup[] = [];
  private readonly tags = new Map<string, PillLabel>();
  private tagsMode: 'sprite' | 'off' = 'off';
  private tagsVisible = true;
  private selectedId: string | null = null;

  private readonly seen = new Set<string>();
  private state: FloorState | null = null;
  private time = 0;
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(layout: FloorLayout, paths: PathFinder, agents: AgentSystem, mats: MaterialSet, look: Look) {
    this.layout = layout;
    this.paths = paths;
    this.agents = agents;
    this.look = look;
    this.group.name = 'effects';

    const parcelGeo = new THREE.BoxGeometry(0.3, 0.22, 0.3);
    this.geometries.push(parcelGeo);
    this.parcelMesh = new THREE.InstancedMesh(parcelGeo, mats.parcel, PARCEL_CAP);
    this.parcelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.parcelMesh.frustumCulled = false;
    this.parcelMesh.castShadow = true;
    this.parcelMesh.count = 0;
    this.group.add(this.parcelMesh);

    const ringGeo = new THREE.RingGeometry(0.44, 0.5, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringOpacity = new THREE.InstancedBufferAttribute(new Float32Array(RING_CAP), 1);
    this.ringOpacity.setUsage(THREE.DynamicDrawUsage);
    ringGeo.setAttribute('aOpacity', this.ringOpacity);
    this.geometries.push(ringGeo);
    this.ringMat = ringMaterial();
    this.ringMesh = new THREE.InstancedMesh(ringGeo, this.ringMat, RING_CAP);
    this.ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ringMesh.frustumCulled = false;
    this.ringMesh.renderOrder = 3;
    this.ringMesh.count = 0;
    this.group.add(this.ringMesh);

    this.counter.sprite.center.set(0.5, 0);
    this.counter.sprite.visible = false;
    this.group.add(this.counter.sprite);
  }

  setReducedMotion(on: boolean) {
    this.reducedMotion = on;
  }

  setLook(look: Look) {
    this.look = look;
  }

  setPalette(palette: LabelPalette) {
    this.palette = palette;
    if (this.state) {
      this.syncBubbles(this.state);
      this.syncCounter();
    }
    for (const p of this.popups) p.label.sprite.visible = false;
    this.popups.length = 0;
  }

  setTagsMode(mode: 'sprite' | 'off') {
    this.tagsMode = mode;
    if (mode === 'off') for (const t of this.tags.values()) t.sprite.visible = false;
  }

  setTagsVisible(visible: boolean) {
    this.tagsVisible = visible;
  }

  setSelected(id: string | null) {
    this.selectedId = id;
  }

  /** Called on every new FloorState. */
  sync(state: FloorState) {
    this.state = state;
    const live = new Set<string>();
    for (const e of state.effects) {
      live.add(e.id);
      if (this.seen.has(e.id)) continue;
      this.seen.add(e.id);
      this.onEffect(state, e);
    }
    for (const id of this.seen) if (!live.has(id)) this.seen.delete(id);
    this.syncQueue(state);
    this.syncBubbles(state);
  }

  private onEffect(state: FloorState, e: FloorEffect) {
    switch (e.kind) {
      case 'delivery':
        this.startDelivery(state, e);
        return;
      case 'call_started': {
        const pos = this.agents.positionOf(e.userId);
        if (pos && !this.reducedMotion) this.bursts.push({ x: pos.x, z: pos.z, t: 0, kind: 'call' });
        return;
      }
      case 'call_outcome': {
        if (!this.palette) return;
        const label = new PillLabel();
        const tone = e.outcome ? OUTCOME_TONE[e.outcome] : 'grey';
        const t = this.palette.tone[tone];
        label.draw(
          {
            text: e.outcome ? OUTCOME_LABEL[e.outcome] : 'Call ended',
            trailing: e.durationSec > 0 ? formatDuration(e.durationSec) : null,
            dot: t.fg,
            bg: t.bg,
            fg: t.fg,
            border: t.border,
            weight: 600,
          },
          this.palette.font,
        );
        label.sprite.center.set(0.5, 0);
        label.sprite.renderOrder = 13;
        this.group.add(label.sprite);
        this.popups.push({ label, userId: e.userId, t: 0 });
        return;
      }
      case 'parcel_spawn':
        if (!this.reducedMotion) this.bursts.push({ x: this.layout.hub.x, z: this.layout.hub.z, t: 0, kind: 'hub' });
        return;
      default:
        return;
    }
  }

  private slotPosition(slot: number) {
    const a = (slot / QUEUE_SLOTS) * Math.PI * 2 + Math.PI / 4;
    return { x: this.layout.hub.x + Math.cos(a) * 1.25, z: this.layout.hub.z + Math.sin(a) * 1.25 };
  }

  private syncQueue(state: FloorState) {
    const shown = state.leadsWaiting.slice(-QUEUE_SLOTS);
    const wanted = new Set(shown.map((l) => l.leadId));
    // Parcels that left the queue without a delivery: shrink away.
    for (const p of this.parcels) {
      if ((p.phase === 'queue' || p.phase === 'drop') && !wanted.has(p.leadId)) {
        p.phase = 'vanish';
        p.t = 0;
      }
    }
    const used = new Set(this.parcels.filter((p) => p.phase === 'queue' || p.phase === 'drop').map((p) => p.slot));
    for (const l of shown) {
      if (this.parcels.some((p) => p.leadId === l.leadId && (p.phase === 'queue' || p.phase === 'drop'))) continue;
      if (this.parcels.length >= PARCEL_CAP) break;
      let slot = 0;
      while (used.has(slot)) slot++;
      used.add(slot);
      const pos = this.slotPosition(slot);
      const fresh = state.effects.some((e) => e.kind === 'parcel_spawn' && e.leadId === l.leadId);
      this.parcels.push({
        key: `q:${l.leadId}`,
        leadId: l.leadId,
        phase: fresh && !this.reducedMotion ? 'drop' : 'queue',
        t: 0,
        x: pos.x,
        y: fresh && !this.reducedMotion ? 2.4 : 0.2,
        z: pos.z,
        slot,
        path: null,
        s: 0,
        cursor: 0,
        from: { x: pos.x, y: 2.4, z: pos.z },
        to: null,
        ownerId: null,
        scale: 1,
      });
    }
    this.waitingCount = state.leadsWaiting.length + state.leadsWaitingExtra;
    this.syncCounter();
  }

  private syncCounter() {
    const extra = this.waitingCount - Math.min(QUEUE_SLOTS, this.waitingCount);
    if (!this.palette || extra <= 0) {
      this.counter.sprite.visible = false;
      return;
    }
    const t = this.palette.tone.indigo;
    this.counter.draw({ text: `+${extra} waiting`, bg: t.bg, fg: t.fg, border: t.border, weight: 600 }, this.palette.font);
    this.counter.sprite.position.set(this.layout.hub.x, 1.05, this.layout.hub.z);
    this.counter.sprite.visible = true;
  }

  private startDelivery(state: FloorState, e: Extract<FloorEffect, { kind: 'delivery' }>) {
    const owner = state.employees[state.index[e.toUserId] ?? -1];
    if (!owner) return;
    const desk = this.layout.desks[owner.desk];
    if (!desk) return;
    const to = { x: desk.deskX, y: 0.62 + 0.11, z: desk.deskZ };

    let start = { x: this.layout.hub.x, y: 0.62, z: this.layout.hub.z };
    const queued = this.parcels.find((p) => p.leadId === e.leadId && (p.phase === 'queue' || p.phase === 'drop' || p.phase === 'vanish'));
    if (queued) {
      start = { x: queued.x, y: queued.y, z: queued.z };
      this.parcels.splice(this.parcels.indexOf(queued), 1);
    } else if (e.fromUserId) {
      const from = state.employees[state.index[e.fromUserId] ?? -1];
      const fromDesk = from ? this.layout.desks[from.desk] : null;
      if (fromDesk) start = { x: fromDesk.deskX, y: 0.73, z: fromDesk.deskZ };
    }
    if (this.parcels.length >= PARCEL_CAP) this.parcels.shift();

    if (this.reducedMotion) {
      this.parcels.push({ key: e.id, leadId: e.leadId, phase: 'landed', t: 0, ...to, slot: -1, path: null, s: 0, cursor: 0, from: to, to, ownerId: owner.id, scale: 1 });
      return;
    }
    const path = this.paths.route(start.x, start.z, desk.x, desk.z);
    this.parcels.push({
      key: e.id,
      leadId: e.leadId,
      phase: 'flight',
      t: 0,
      ...start,
      slot: -1,
      path,
      s: 0,
      cursor: 0,
      from: start,
      to,
      ownerId: owner.id,
      scale: 1,
    });
  }

  private syncBubbles(state: FloorState) {
    const groups = new Map<string, AttentionItem[]>();
    for (const item of state.attention) {
      const key = item.userId ?? '';
      if (item.userId && state.index[item.userId] === undefined) continue;
      const g = groups.get(key);
      if (g) g.push(item);
      else groups.set(key, [item]);
    }
    for (const [key, b] of this.bubbles) {
      if (!groups.has(key)) {
        this.group.remove(b.label.sprite);
        b.label.dispose();
        this.bubbles.delete(key);
      }
    }
    if (!this.palette) return;
    for (const [key, items] of groups) {
      let b = this.bubbles.get(key);
      if (!b) {
        const label = new PillLabel();
        label.sprite.center.set(0.5, 0);
        label.sprite.renderOrder = 12;
        label.sprite.userData.bubbleKey = key;
        this.group.add(label.sprite);
        b = { label, items, tone: 'amber' };
        this.bubbles.set(key, b);
      }
      b.items = items;
      const worst = items.reduce((m, i) => (SEVERITY[i.severity] > SEVERITY[m.severity] ? i : m), items[0]!);
      b.tone = SEVERITY_TONE[worst.severity];
      const t = this.palette.tone[b.tone];
      b.label.draw(
        { text: items.length > 1 ? `Needs you · ${items.length}` : 'Needs you', badge: t.fg, bg: t.bg, fg: t.fg, border: t.border, weight: 600 },
        this.palette.font,
      );
    }
  }

  /** Bubble under the ray (sprites are tested first: they render on top). */
  pick(raycaster: THREE.Raycaster): BubbleHit | null {
    const sprites = [...this.bubbles.values()].map((b) => b.label.sprite).filter((s) => s.visible);
    const hit = raycaster.intersectObjects(sprites, false)[0];
    if (!hit) return null;
    const key = hit.object.userData.bubbleKey as string;
    const b = this.bubbles.get(key);
    return b ? { userId: key || null, itemIds: b.items.map((i) => i.id) } : null;
  }

  /** Name tags (sprite mode); called each frame with the shared clock. */
  private updateTags(zoom: number, nowMs: number) {
    const state = this.state;
    const palette = this.palette;
    if (!state || !palette || this.tagsMode !== 'sprite') return;
    for (const emp of state.employees) {
      let tag = this.tags.get(emp.id);
      const show = (this.tagsVisible || emp.id === this.selectedId) && emp.status !== 'offline';
      const head = show ? this.agents.headOf(emp.id, tmpV) : null;
      if (!head) {
        if (tag) tag.sprite.visible = false;
        continue;
      }
      if (!tag) {
        tag = new PillLabel();
        tag.sprite.center.set(0.5, 0);
        this.tags.set(emp.id, tag);
        this.group.add(tag.sprite);
      }
      tag.draw(tagSpec(emp, palette, nowMs), palette.font);
      tag.fit(zoom);
      tag.sprite.position.set(head.x, head.y + 0.08, head.z);
      tag.sprite.visible = true;
    }
  }

  /** Advance animations. Returns true while something moves. */
  update(dt: number, zoom: number, nowMs: number): boolean {
    this.time += dt;
    const rm = this.reducedMotion;
    let moving = false;

    // Parcels.
    let n = 0;
    for (let i = this.parcels.length - 1; i >= 0; i--) {
      const p = this.parcels[i]!;
      p.t += dt;
      switch (p.phase) {
        case 'drop': {
          const u = Math.min(1, p.t / 0.6);
          const bounce = 1 - (1 - u) ** 3;
          p.y = p.from.y + (0.2 - p.from.y) * bounce;
          if (u >= 1) {
            p.phase = 'queue';
            p.t = 0;
          }
          moving = true;
          break;
        }
        case 'queue':
          p.y = 0.2 + (rm ? 0 : 0.035 * Math.sin(this.time * 2.2 + p.slot));
          break;
        case 'flight': {
          if (!p.path || !p.to) {
            p.phase = 'land';
            p.t = 0;
            break;
          }
          p.s += FLIGHT_SPEED * dt;
          p.cursor = samplePath(p.path, p.s, p.cursor, sample);
          const u = Math.min(1, p.s / Math.max(0.01, p.path.length));
          p.x = sample.x;
          p.z = sample.z;
          p.y = p.from.y + (1.15 - p.from.y) * Math.min(1, u * 4) + Math.sin(u * Math.PI) * 0.25;
          if (p.ownerId && p.path.length - p.s < 3) this.agents.lookAt(p.ownerId, p.x, p.z, 0.4);
          if (p.s >= p.path.length) {
            p.phase = 'land';
            p.t = 0;
            p.from = { x: p.x, y: p.y, z: p.z };
            if (p.ownerId) this.agents.receive(p.ownerId);
          }
          moving = true;
          break;
        }
        case 'land': {
          const to = p.to ?? p.from;
          const u = Math.min(1, p.t / 0.4);
          const e = u * u * (3 - 2 * u);
          p.x = p.from.x + (to.x - p.from.x) * e;
          p.z = p.from.z + (to.z - p.from.z) * e;
          p.y = p.from.y + (to.y - p.from.y) * e;
          if (u >= 1) {
            p.phase = 'landed';
            p.t = 0;
          }
          moving = true;
          break;
        }
        case 'landed':
          if (p.t > (rm ? 2.5 : 2.2)) {
            p.phase = 'vanish';
            p.t = 0;
          }
          break;
        case 'vanish': {
          p.scale = Math.max(0, 1 - p.t / 0.35);
          if (rm || p.scale <= 0) {
            this.parcels.splice(i, 1);
            continue;
          }
          moving = true;
          break;
        }
      }
      if (n < PARCEL_CAP) {
        tmpQ.setFromAxisAngle(tmpV.set(0, 1, 0), p.phase === 'queue' ? p.slot * 0.5 + this.time * (rm ? 0 : 0.4) : p.t * 2);
        tmpS.setScalar(p.scale);
        tmpM.compose(tmpV.set(p.x, p.y, p.z), tmpQ, tmpS);
        this.parcelMesh.setMatrixAt(n++, tmpM);
      }
    }
    this.parcelMesh.count = n;
    this.parcelMesh.instanceMatrix.needsUpdate = true;

    // Rings: on-call pulses and bursts.
    let r = 0;
    const blue = this.look.status.on_call;
    const accent = this.look.color.hubRing;
    const putRing = (x: number, z: number, scale: number, opacity: number, color: THREE.Color) => {
      if (r >= RING_CAP || opacity <= 0.01) return;
      tmpM.makeScale(scale, 1, scale).setPosition(x, 0.02 + r * 0.00002, z);
      this.ringMesh.setMatrixAt(r, tmpM);
      this.ringMesh.setColorAt(r, color);
      this.ringOpacity.setX(r, opacity);
      r++;
    };
    const state = this.state;
    if (state) {
      for (const emp of state.employees) {
        if (emp.status !== 'on_call') continue;
        const pos = this.agents.positionOf(emp.id);
        if (!pos || !pos.visible) continue;
        if (rm) {
          putRing(pos.x, pos.z, 1.4, 0.45, blue);
          continue;
        }
        for (let k = 0; k < 2; k++) {
          const u = (this.time / 1.7 + k / 2 + (emp.desk % 7) * 0.13) % 1;
          putRing(pos.x, pos.z, 0.85 + u * 1.3, 0.6 * (1 - u), blue);
        }
      }
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.t += dt;
      const life = b.kind === 'hub' ? 1.1 : 1.3;
      if (b.t > life) {
        this.bursts.splice(i, 1);
        continue;
      }
      moving = true;
      if (b.kind === 'hub') {
        const u = b.t / life;
        putRing(b.x, b.z, 2 + u * 4, 0.7 * (1 - u), accent);
      } else {
        for (let k = 0; k < 3; k++) {
          const u = Math.min(1, Math.max(0, (b.t - k * 0.18) / 0.9));
          if (u > 0 && u < 1) putRing(b.x, b.z, 0.8 + u * 2.2, 0.8 * (1 - u), blue);
        }
      }
    }
    this.ringMesh.count = r;
    this.ringMesh.instanceMatrix.needsUpdate = true;
    if (this.ringMesh.instanceColor) this.ringMesh.instanceColor.needsUpdate = true;
    this.ringOpacity.needsUpdate = true;

    // Bubbles above heads (or the manager cabin).
    for (const [key, b] of this.bubbles) {
      let x: number;
      let y: number;
      let z: number;
      if (!key) {
        x = this.layout.cabinSeat.x;
        y = 1.45;
        z = this.layout.cabinSeat.z;
      } else {
        const head = this.agents.headOf(key, tmpV);
        if (head) {
          x = head.x;
          y = head.y + (this.tagsVisible ? 0.62 : 0.12);
          z = head.z;
        } else {
          const emp = state?.employees[state.index[key] ?? -1];
          const desk = emp ? this.layout.desks[emp.desk] : null;
          if (!desk) {
            b.label.sprite.visible = false;
            continue;
          }
          x = desk.deskX;
          y = 1.2;
          z = desk.deskZ;
        }
      }
      b.label.sprite.position.set(x, y + (rm ? 0 : 0.05 * Math.sin(this.time * 2.4)), z);
      b.label.fit(zoom);
      b.label.sprite.visible = true;
    }

    // Outcome popups (~3 s).
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.t += dt;
      if (p.t > 3.2) {
        this.group.remove(p.label.sprite);
        p.label.dispose();
        this.popups.splice(i, 1);
        continue;
      }
      const head = this.agents.headOf(p.userId, tmpV);
      if (!head) {
        p.label.sprite.visible = false;
        continue;
      }
      const rise = rm ? 0 : Math.min(1, p.t / 3) * 0.45;
      p.label.sprite.position.set(head.x, head.y + 1.05 + rise, head.z);
      p.label.material.opacity = rm ? 1 : Math.min(1, p.t / 0.2, (3.2 - p.t) / 0.5);
      p.label.fit(zoom);
      p.label.sprite.visible = true;
      moving = true;
    }

    this.counter.fit(zoom);
    this.updateTags(zoom, nowMs);
    return moving;
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    this.ringMat.dispose();
    this.parcelMesh.dispose();
    this.ringMesh.dispose();
    this.counter.dispose();
    for (const b of this.bubbles.values()) b.label.dispose();
    for (const p of this.popups) p.label.dispose();
    for (const t of this.tags.values()) t.dispose();
  }
}

function tagSpec(emp: FloorEmployee, palette: LabelPalette, nowMs: number) {
  const timer = emp.status === 'on_call' && emp.activeCall ? formatDuration((nowMs - emp.activeCall.startedAt) / 1000) : null;
  return {
    text: firstName(emp.name),
    dot: palette.status[emp.status],
    trailing: timer,
    bg: palette.surface,
    fg: palette.fg,
    border: palette.border,
  };
}
