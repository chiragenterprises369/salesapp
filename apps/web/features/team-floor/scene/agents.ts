import type { EmployeeStatus } from '@vistar/shared';
import * as THREE from 'three';
import type { FloorLayout, HomeSlot, Spot } from '../state/layout';
import { samplePath, type FollowPath, type PathFinder } from '../state/pathfinding';
import { locationOf } from '../state/selectors';
import type { FloorEmployee, FloorLocation, FloorState } from '../state/types';
import { applyReceive, applyWave, emptyParams, evalClip, lerpParams, type CharacterModel, type ClipName, type LodLevel, type PoseParams, type PropName } from './characters';

/**
 * Per-employee animation state (plain objects, not React state), advanced every frame. React only
 * pushes new FloorState snapshots on events. Places come from the floor template: the person's home
 * (desk, hot desk, reception, cabin, standing or overflow spot), a calling booth, a lounge seat, or
 * the entrance (offline people walk out, unless they nap at their desk).
 */

const WALK_SPEED = 1.35; // metres per second
const TURN_RATE = 8; // rad/s
const BLEND_S = 0.28;
const WAVE_S = 2.5;
const RECEIVE_S = 1.2;
/** How far a seated caller swivels towards the room (radians). */
const CALL_SWIVEL = 0.95;

interface Agent {
  id: string;
  slot: number;
  status: EmployeeStatus;
  location: FloorLocation;
  rest: Spot | null;
  home: HomeSlot | null;
  x: number;
  z: number;
  heading: number;
  visible: boolean;
  path: FollowPath | null;
  s: number;
  cursor: number;
  leaving: boolean;
  seated: boolean;
  prop: PropName;
  walks: number;
  clip: ClipName;
  prevClip: ClipName;
  blend: number;
  time: number;
  phase: number;
  waveAt: number;
  receiveAt: number;
  look: { x: number; z: number; until: number } | null;
  scale: number;
}

const scratchA = emptyParams();
const scratchB = emptyParams();
const pose = { x: 0, z: 0, heading: 0, visible: true, seated: false, clip: 'idle' as ClipName, prop: 'none' as PropName, params: emptyParams() };
const sample = { x: 0, z: 0, dx: 0, dz: 0 };

function hash(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function angleLerp(a: number, b: number, max: number) {
  const d = wrap(b - a);
  return a + Math.max(-max, Math.min(max, d));
}

export class AgentSystem {
  private readonly layout: FloorLayout;
  private readonly paths: PathFinder;
  private model: CharacterModel;
  private agents: Agent[] = [];
  private readonly byId = new Map<string, Agent>();
  private reducedMotion = false;
  private lod: LodLevel = 'near';
  private clock = 0;
  private statusColors: Record<EmployeeStatus, THREE.Color> | null = null;
  private readonly roomHeading: number;

  constructor(layout: FloorLayout, paths: PathFinder, model: CharacterModel) {
    this.layout = layout;
    this.paths = paths;
    this.model = model;
    this.roomHeading = (layout.template.camera.yawDeg * Math.PI) / 180;
  }

  /** Swap the character model (procedural placeholder -> GLB) keeping every agent's state. */
  setModel(model: CharacterModel, state: FloorState | null) {
    this.model = model;
    model.setLod(this.lod);
    model.setReducedMotion(this.reducedMotion);
    if (!state) return;
    for (const a of this.agents) {
      if (!a) continue;
      const emp = state.employees[a.slot];
      model.setAppearance(a.slot, emp?.avatar ?? null, a.id);
      if (this.statusColors) model.setStatusColor(a.slot, this.statusColors[a.status], a.status === 'on_call');
    }
  }

  setReducedMotion(on: boolean) {
    this.reducedMotion = on;
    this.model.setReducedMotion(on);
  }

  setLod(level: LodLevel) {
    this.lod = level;
    this.model.setLod(level);
  }

  setStatusColors(colors: Record<EmployeeStatus, THREE.Color>) {
    this.statusColors = colors;
    for (const a of this.agents) if (a) this.model.setStatusColor(a.slot, colors[a.status], a.status === 'on_call');
  }

  /** Sync agents with a new floor state (called on events only). */
  sync(state: FloorState, waves: Iterable<string>) {
    state.employees.forEach((emp, slot) => {
      let agent = this.byId.get(emp.id);
      const location = locationOf(state, emp);
      if (!agent) {
        agent = this.spawn(emp, slot, location);
        this.byId.set(emp.id, agent);
        this.agents[slot] = agent;
        this.model.setAppearance(slot, emp.avatar, emp.id);
        if (this.statusColors) this.model.setStatusColor(slot, this.statusColors[emp.status], emp.status === 'on_call');
      } else if (!sameLocation(agent.location, location)) {
        this.moveTo(agent, emp, location);
      }
      if (agent.status !== emp.status) {
        agent.status = emp.status;
        if (this.statusColors) this.model.setStatusColor(slot, this.statusColors[emp.status], emp.status === 'on_call');
      }
      agent.location = location;
    });
    for (const id of waves) {
      const a = this.byId.get(id);
      if (a && !a.path && !this.reducedMotion) a.waveAt = this.clock;
    }
  }

  private spotFor(emp: FloorEmployee, loc: FloorLocation): Spot | null {
    switch (loc.kind) {
      case 'desk':
        return this.layout.homes[emp.desk] ?? null;
      case 'booth':
        return this.layout.booths[loc.index] ?? null;
      case 'lounge':
        return this.layout.lounge[loc.index] ?? null;
      case 'zone': {
        const zone = this.layout.zones[this.layout.zoneIndex.get(loc.zoneId) ?? -1];
        return zone?.spots[loc.index] ?? this.layout.homes[emp.desk] ?? null;
      }
      case 'gone':
        return null;
    }
  }

  private spawn(emp: FloorEmployee, slot: number, loc: FloorLocation): Agent {
    const rest = this.spotFor(emp, loc);
    const home = this.layout.homes[emp.desk] ?? null;
    const at = rest ?? home ?? { x: this.layout.entrance.x, z: this.layout.entrance.z, facing: 0, seated: false };
    const agent: Agent = {
      id: emp.id,
      slot,
      status: emp.status,
      location: loc,
      rest,
      home,
      x: at.x,
      z: at.z,
      heading: at.facing,
      visible: loc.kind !== 'gone',
      path: null,
      s: 0,
      cursor: 0,
      leaving: false,
      seated: rest?.seated ?? false,
      prop: 'none',
      walks: 0,
      clip: 'idle',
      prevClip: 'idle',
      blend: 1,
      time: hash(emp.id) * 10,
      phase: hash(emp.id + 'p') * 6,
      waveAt: -100,
      receiveAt: -100,
      look: null,
      scale: 1,
    };
    agent.clip = this.restClip(agent);
    agent.prevClip = agent.clip;
    return agent;
  }

  private moveTo(agent: Agent, emp: FloorEmployee, loc: FloorLocation) {
    const rest = this.spotFor(emp, loc);
    const { entrance } = this.layout;
    const jitter = (hash(agent.id + 'e') - 0.5) * 0.8;
    const from = agent.rest;
    agent.rest = rest;
    agent.look = null;

    if (this.reducedMotion) {
      agent.path = null;
      agent.leaving = false;
      agent.visible = !!rest;
      if (rest) {
        agent.x = rest.x;
        agent.z = rest.z;
        agent.heading = rest.facing;
        agent.seated = rest.seated;
      }
      return;
    }

    let fromNode = !agent.path && from ? from.approach : undefined;
    if (!agent.visible && rest) {
      // Arrives through the entrance.
      agent.x = entrance.x + jitter;
      agent.z = entrance.z;
      agent.heading = Math.PI;
      agent.visible = true;
      fromNode = entrance.approach;
    }
    const target = rest ?? { x: entrance.x + jitter, z: entrance.z + 0.3, approach: entrance.approach };
    const path = this.paths.route(agent.x, agent.z, target.x, target.z, { fromNode, toNode: target.approach });
    if (!path || path.length < 0.05) {
      agent.path = null;
      agent.leaving = false;
      if (rest) {
        agent.x = rest.x;
        agent.z = rest.z;
        agent.seated = rest.seated;
      } else {
        agent.visible = false;
      }
      return;
    }
    agent.path = path;
    agent.s = 0;
    agent.cursor = 0;
    agent.leaving = !rest;
    agent.seated = false;
    agent.walks += 1;
    // Callers walk with their phone; some walkers carry a document.
    agent.prop = loc.kind === 'booth' ? 'phone' : hash(`${agent.id}:${agent.walks}`) < 0.5 ? 'document' : 'none';
  }

  private restClip(agent: Agent): ClipName {
    const seated = agent.seated;
    const atWork = agent.rest && (agent.rest as HomeSlot).screen !== undefined ? !!(agent.rest as HomeSlot).screen : agent.location.kind === 'booth';
    switch (agent.status) {
      case 'on_call':
        return 'phone';
      case 'busy':
        return seated && atWork ? 'typing' : seated ? 'sit' : 'idle';
      case 'away':
        return agent.location.kind === 'lounge' ? 'sit' : seated && atWork ? 'sleeping' : seated ? 'sit' : 'idle';
      case 'offline':
        return seated && atWork ? 'sleeping' : seated ? 'sit' : 'idle';
      default:
        return seated ? 'sit' : 'idle';
    }
  }

  /** Make the owner of `userId` turn towards a point (incoming parcel). */
  lookAt(userId: string, x: number, z: number, seconds: number) {
    const a = this.byId.get(userId);
    if (!a || a.path || !a.visible) return;
    a.look = { x, z, until: this.clock + seconds };
  }

  receive(userId: string) {
    const a = this.byId.get(userId);
    if (!a || a.path || !a.visible || this.reducedMotion) return;
    a.receiveAt = this.clock;
  }

  /** World position of an agent's head top (for tags and bubbles). */
  headOf(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const a = this.byId.get(id);
    if (!a || !a.visible) return null;
    const seated = a.seated && !a.path;
    let y = this.model.headTop(seated);
    if (seated && (a.clip === 'sleeping' || a.clip === 'typing')) y -= a.clip === 'sleeping' ? 0.42 : 0.04;
    return out.set(a.x, y + 0.06, a.z);
  }

  positionOf(id: string): { x: number; z: number; visible: boolean; walking: boolean } | null {
    const a = this.byId.get(id);
    return a ? { x: a.x, z: a.z, visible: a.visible, walking: !!a.path } : null;
  }

  idAt(slot: number): string | null {
    return this.agents[slot]?.id ?? null;
  }

  isAtDesk(id: string): boolean {
    const a = this.byId.get(id);
    return !!a && a.visible && !a.path && a.location.kind === 'desk';
  }

  /** Who is at a seat with a screen and how busy (for monitor brightness). */
  screens(): Map<string, number> {
    const out = new Map<string, number>();
    for (const a of this.agents) {
      if (!a || !a.home?.screen) continue;
      const present = a.visible && !a.path && a.location.kind === 'desk';
      const level = !present || a.status === 'offline' ? 0.08 : a.status === 'busy' || a.status === 'on_call' ? 1 : 0.55;
      out.set(a.home.screen, Math.max(out.get(a.home.screen) ?? 0, level));
    }
    return out;
  }

  /** True when something moves (walks, turns, blends) and frames should keep coming. */
  get moving(): boolean {
    return this.agents.some((a) => a && (a.path !== null || a.blend < 1 || a.look !== null || this.clock - a.waveAt < WAVE_S || this.clock - a.receiveAt < RECEIVE_S));
  }

  /** True when looping clips (typing, phone, breathing) would animate. */
  get ambient(): boolean {
    return !this.reducedMotion && this.agents.some((a) => a && a.visible);
  }

  update(dt: number) {
    this.clock += dt;
    const rm = this.reducedMotion;
    const procedural = this.model.kind === 'procedural';
    const far = this.lod === 'far';
    for (const a of this.agents) {
      if (!a) continue;
      if (a.path) {
        a.s += WALK_SPEED * dt;
        a.cursor = samplePath(a.path, a.s, a.cursor, sample);
        a.x = sample.x;
        a.z = sample.z;
        if (sample.dx * sample.dx + sample.dz * sample.dz > 1e-8) a.heading = angleLerp(a.heading, Math.atan2(sample.dx, sample.dz), TURN_RATE * dt);
        if (a.s >= a.path.length) {
          a.path = null;
          a.prop = 'none';
          if (a.leaving) {
            a.visible = false;
            a.leaving = false;
          } else if (a.rest) {
            a.x = a.rest.x;
            a.z = a.rest.z;
            a.seated = a.rest.seated;
          }
        }
      } else if (a.rest) {
        let face = a.rest.facing;
        if (a.status === 'on_call') {
          // Swivel towards the room (and the camera) while talking; booths define their own angle.
          face = a.rest.callFacing ?? angleLerp(face, this.roomHeading, CALL_SWIVEL);
        }
        if (a.look) {
          if (this.clock > a.look.until) a.look = null;
          else face += Math.max(-1.1, Math.min(1.1, wrap(Math.atan2(a.look.x - a.x, a.look.z - a.z) - face)));
        }
        a.heading = rm ? face : angleLerp(a.heading, face, TURN_RATE * 0.5 * dt);
      }

      const seated = a.seated && !a.path;
      let clip: ClipName = a.path ? 'walking' : this.restClip(a);
      const waving = this.clock - a.waveAt < WAVE_S;
      const receiving = this.clock - a.receiveAt < RECEIVE_S;
      if (!a.path && waving && clip !== 'phone') clip = 'wave';
      else if (!a.path && receiving && seated) clip = 'receive';
      if (clip !== a.clip) {
        a.prevClip = a.clip;
        a.clip = clip;
        a.blend = rm ? 1 : 0;
      }
      if (!rm) a.time += dt;
      a.blend = Math.min(1, a.blend + dt / BLEND_S);

      pose.x = a.x;
      pose.z = a.z;
      pose.heading = a.heading;
      pose.visible = a.visible;
      pose.seated = seated;
      pose.clip = a.clip;
      pose.prop = a.path ? a.prop : a.status === 'on_call' ? 'phone' : 'none';
      if (procedural) this.proceduralParams(a, seated, far, rm);
      this.model.update(a.slot, pose, dt);
    }
    this.model.commit();
  }

  private proceduralParams(a: Agent, seated: boolean, far: boolean, rm: boolean) {
    const base = (c: ClipName): Parameters<typeof evalClip>[0] => (c === 'sit' || c === 'wave' || c === 'receive' ? 'idle' : c);
    if (a.visible && !far) {
      const t = rm ? 0 : a.time;
      let p: PoseParams = evalClip(base(a.clip), t, a.phase, seated, scratchB);
      if (a.blend < 1) p = lerpParams(evalClip(base(a.prevClip), t, a.phase, seated, scratchA), p, easeInOut(a.blend), pose.params);
      else Object.assign(pose.params, p);
      const wave = envelope(this.clock - a.waveAt, WAVE_S);
      if (wave > 0) applyWave(pose.params, this.clock, wave);
      const recv = envelope(this.clock - a.receiveAt, RECEIVE_S);
      if (recv > 0) applyReceive(pose.params, recv);
    } else if (a.visible) {
      evalClip(a.path ? 'walking' : 'idle', 0, 0, seated, pose.params);
    }
  }
}

function sameLocation(a: FloorLocation, b: FloorLocation) {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'booth' && b.kind === 'booth') return a.index === b.index;
  if (a.kind === 'lounge' && b.kind === 'lounge') return a.index === b.index;
  if (a.kind === 'zone' && b.kind === 'zone') return a.zoneId === b.zoneId && a.index === b.index;
  return true;
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/** 0 -> 1 -> 0 envelope over `duration` seconds with 0.2 s ramps. */
function envelope(elapsed: number, duration: number) {
  if (elapsed < 0 || elapsed > duration) return 0;
  return Math.min(1, elapsed / 0.2, (duration - elapsed) / 0.25);
}
