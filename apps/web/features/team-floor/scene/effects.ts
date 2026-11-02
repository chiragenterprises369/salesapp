import * as THREE from 'three';
import type { FloorLayout } from '../state/layout';
import type { FollowPath, PathFinder } from '../state/pathfinding';
import { samplePath } from '../state/pathfinding';
import type { FloorEffect, FloorState } from '../state/types';
import type { AgentSystem } from './agents';
import type { Look } from './look';

/**
 * Event reactions in 3D: glowing parcels at the Lead Hub and in flight to desks, sound-wave rings
 * for calls and hub bursts. Text (name tags, "Needs you", call outcomes, the queue counter) lives in
 * the DOM label layer so it can be laid out without overlaps (see label-layout.ts).
 */

const QUEUE_SLOTS = 12;
const PARCEL_CAP = 48;
const RING_CAP = 512;
const FLIGHT_SPEED = 3.4;
/** Height of the waiting-lead orbit above the hub. */
const QUEUE_Y = 1.55;

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

function ringMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false });
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

export class EffectsSystem {
  readonly group = new THREE.Group();
  private readonly layout: FloorLayout;
  private readonly paths: PathFinder;
  private readonly agents: AgentSystem;
  private look: Look;
  private reducedMotion = false;

  private readonly parcelMat: THREE.MeshLambertMaterial;
  private readonly parcelMesh: THREE.InstancedMesh;
  private readonly parcels: Parcel[] = [];

  private readonly ringMesh: THREE.InstancedMesh;
  private readonly ringOpacity: THREE.InstancedBufferAttribute;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly bursts: Burst[] = [];

  private readonly seen = new Set<string>();
  private state: FloorState | null = null;
  private time = 0;
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(layout: FloorLayout, paths: PathFinder, agents: AgentSystem, look: Look) {
    this.layout = layout;
    this.paths = paths;
    this.agents = agents;
    this.look = look;
    this.group.name = 'effects';

    // Leads are small glowing cards: waiting ones orbit above the Lead Hub, assigned ones fly to the desk.
    const parcelGeo = new THREE.BoxGeometry(0.26, 0.035, 0.19);
    this.geometries.push(parcelGeo);
    this.parcelMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: look.hub, emissiveIntensity: 0.9 });
    this.parcelMesh = new THREE.InstancedMesh(parcelGeo, this.parcelMat, PARCEL_CAP);
    this.parcelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.parcelMesh.frustumCulled = false;
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
  }

  setReducedMotion(on: boolean) {
    this.reducedMotion = on;
  }

  setLook(look: Look) {
    this.look = look;
    this.parcelMat.emissive.copy(look.hub);
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
      case 'parcel_spawn':
        if (!this.reducedMotion) this.bursts.push({ x: this.layout.hub.x, z: this.layout.hub.z, t: 0, kind: 'hub' });
        return;
      default:
        return;
    }
  }

  private slotPosition(slot: number) {
    const a = (slot / QUEUE_SLOTS) * Math.PI * 2 + Math.PI / 4 + this.time * (this.reducedMotion ? 0 : 0.35);
    const r = 0.95 + (slot % 2) * 0.12;
    return { x: this.layout.hub.x + Math.cos(a) * r, z: this.layout.hub.z + Math.sin(a) * r };
  }

  private syncQueue(state: FloorState) {
    const shown = state.leadsWaiting.slice(-QUEUE_SLOTS);
    const wanted = new Set(shown.map((l) => l.leadId));
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
        y: fresh && !this.reducedMotion ? 3.2 : QUEUE_Y,
        z: pos.z,
        slot,
        path: null,
        s: 0,
        cursor: 0,
        from: { x: pos.x, y: 3.2, z: pos.z },
        to: null,
        ownerId: null,
        scale: 1,
      });
    }
  }

  private startDelivery(state: FloorState, e: Extract<FloorEffect, { kind: 'delivery' }>) {
    const owner = state.employees[state.index[e.toUserId] ?? -1];
    if (!owner) return;
    const home = this.layout.homes[owner.desk];
    if (!home) return;
    const to = { x: home.deskX, y: home.deskY + 0.11, z: home.deskZ };

    let start = { x: this.layout.hub.x, y: 0.62, z: this.layout.hub.z };
    const queued = this.parcels.find((p) => p.leadId === e.leadId && (p.phase === 'queue' || p.phase === 'drop' || p.phase === 'vanish'));
    if (queued) {
      start = { x: queued.x, y: queued.y, z: queued.z };
      this.parcels.splice(this.parcels.indexOf(queued), 1);
    } else if (e.fromUserId) {
      const from = state.employees[state.index[e.fromUserId] ?? -1];
      const fromHome = from ? this.layout.homes[from.desk] : null;
      if (fromHome) start = { x: fromHome.deskX, y: fromHome.deskY + 0.1, z: fromHome.deskZ };
    }
    if (this.parcels.length >= PARCEL_CAP) this.parcels.shift();

    if (this.reducedMotion) {
      this.parcels.push({ key: e.id, leadId: e.leadId, phase: 'landed', t: 0, ...to, slot: -1, path: null, s: 0, cursor: 0, from: to, to, ownerId: owner.id, scale: 1 });
      return;
    }
    const path = this.paths.route(start.x, start.z, home.x, home.z, { fromNode: this.layout.hub.approach, toNode: home.approach });
    this.parcels.push({ key: e.id, leadId: e.leadId, phase: 'flight', t: 0, ...start, slot: -1, path, s: 0, cursor: 0, from: start, to, ownerId: owner.id, scale: 1 });
  }

  /** Something will change without motion (parcel expiry): wake up now and then. */
  get pending(): boolean {
    return this.parcels.some((p) => p.phase === 'landed' || p.phase === 'vanish');
  }

  /** Advance animations. Returns true while something moves. */
  update(dt: number): boolean {
    this.time += dt;
    const rm = this.reducedMotion;
    let moving = false;

    let n = 0;
    for (let i = this.parcels.length - 1; i >= 0; i--) {
      const p = this.parcels[i]!;
      p.t += dt;
      switch (p.phase) {
        case 'drop': {
          const u = Math.min(1, p.t / 0.6);
          const bounce = 1 - (1 - u) ** 3;
          p.y = p.from.y + (QUEUE_Y - p.from.y) * bounce;
          if (u >= 1) {
            p.phase = 'queue';
            p.t = 0;
          }
          moving = true;
          break;
        }
        case 'queue': {
          const pos = this.slotPosition(p.slot);
          p.x = pos.x;
          p.z = pos.z;
          p.y = QUEUE_Y + (p.slot % 3) * 0.09 + (rm ? 0 : 0.04 * Math.sin(this.time * 2.2 + p.slot));
          break;
        }
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
          p.y = p.from.y + (1.5 - p.from.y) * Math.min(1, u * 4) + Math.sin(u * Math.PI) * 0.3;
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
    const accent = this.look.hub;
    const putRing = (x: number, z: number, scale: number, opacity: number, color: THREE.Color) => {
      if (r >= RING_CAP || opacity <= 0.01) return;
      tmpM.makeScale(scale, 1, scale).setPosition(x, 0.02 + r * 0.00002, z);
      this.ringMesh.setMatrixAt(r, tmpM);
      this.ringMesh.setColorAt(r, color);
      this.ringOpacity.setX(r, opacity);
      r++;
    };
    const state = this.state;
    if (state && !rm) {
      for (const emp of state.employees) {
        if (emp.status !== 'on_call') continue;
        const pos = this.agents.positionOf(emp.id);
        if (!pos || !pos.visible || pos.walking) continue;
        for (let k = 0; k < 2; k++) {
          const u = (this.time / 1.9 + k / 2 + (emp.desk % 7) * 0.13) % 1;
          putRing(pos.x, pos.z, 1.05 + u * 1.1, 0.5 * (1 - u), blue);
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
        putRing(b.x, b.z, 3 + u * 4, 0.7 * (1 - u), accent);
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
    return moving;
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    this.ringMat.dispose();
    this.parcelMat.dispose();
    this.parcelMesh.dispose();
    this.ringMesh.dispose();
  }
}
