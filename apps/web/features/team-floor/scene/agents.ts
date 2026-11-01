import type { EmployeeStatus } from '@vistar/shared';
import * as THREE from 'three';
import type { FloorLayout, Spot } from '../state/layout';
import { samplePath, type FollowPath, type PathFinder } from '../state/pathfinding';
import { locationOf } from '../state/selectors';
import type { FloorEmployee, FloorLocation, FloorState } from '../state/types';
import {
  applyReceive,
  applyWave,
  emptyParams,
  evalClip,
  headTop,
  lerpParams,
  type CharacterModel,
  type ClipName,
  type LodLevel,
  type PoseParams,
} from './characters';

/**
 * Per-employee animation state lives here (plain objects, not React state) and advances every
 * frame. React only pushes new FloorState snapshots on events.
 */

const WALK_SPEED = 1.6; // tiles per second
const TURN_RATE = 9; // rad/s
const BLEND_S = 0.28;
const WAVE_S = 1.7;
const RECEIVE_S = 1.1;

interface Agent {
  id: string;
  slot: number;
  status: EmployeeStatus;
  location: FloorLocation;
  rest: Spot | null;
  x: number;
  z: number;
  heading: number;
  visible: boolean;
  path: FollowPath | null;
  s: number;
  cursor: number;
  /** Hide when the walk ends (walked out of the office). */
  leaving: boolean;
  seated: boolean;
  clip: ClipName;
  prevClip: ClipName;
  blend: number;
  time: number;
  phase: number;
  waveAt: number;
  receiveAt: number;
  look: { x: number; z: number; until: number } | null;
}

const scratchA = emptyParams();
const scratchB = emptyParams();
const pose = { x: 0, z: 0, heading: 0, visible: true, params: emptyParams() };
const sample = { x: 0, z: 0, dx: 0, dz: 0 };

function hash(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function angleLerp(a: number, b: number, max: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + Math.max(-max, Math.min(max, d));
}

export class AgentSystem {
  private readonly layout: FloorLayout;
  private readonly paths: PathFinder;
  private readonly model: CharacterModel;
  private agents: Agent[] = [];
  private readonly byId = new Map<string, Agent>();
  private reducedMotion = false;
  private lod: LodLevel = 'near';
  private clock = 0;
  private statusColors: Record<EmployeeStatus, THREE.Color> | null = null;

  constructor(layout: FloorLayout, paths: PathFinder, model: CharacterModel) {
    this.layout = layout;
    this.paths = paths;
    this.model = model;
  }

  setReducedMotion(on: boolean) {
    this.reducedMotion = on;
  }

  setLod(level: LodLevel) {
    this.lod = level;
    this.model.setLod(level);
  }

  setStatusColors(colors: Record<EmployeeStatus, THREE.Color>) {
    this.statusColors = colors;
    for (const a of this.agents) this.model.setStatusColor(a.slot, colors[a.status]);
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
        this.model.setAppearance(slot, emp.avatar);
        if (this.statusColors) this.model.setStatusColor(slot, this.statusColors[emp.status]);
      } else if (!sameLocation(agent.location, location)) {
        this.moveTo(agent, emp, location);
      }
      if (agent.status !== emp.status) {
        agent.status = emp.status;
        if (this.statusColors) this.model.setStatusColor(slot, this.statusColors[emp.status]);
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
        return this.layout.desks[emp.desk] ?? null;
      case 'booth':
        return this.layout.booths[loc.index] ?? null;
      case 'lounge':
        return this.layout.lounge[loc.index] ?? null;
      case 'gone':
        return null;
    }
  }

  private spawn(emp: FloorEmployee, slot: number, loc: FloorLocation): Agent {
    const rest = this.spotFor(emp, loc);
    const desk = this.layout.desks[emp.desk];
    const at = rest ?? desk ?? { x: this.layout.entrance.x, z: this.layout.entrance.z, facing: 0, seated: false };
    const agent: Agent = {
      id: emp.id,
      slot,
      status: emp.status,
      location: loc,
      rest,
      x: at.x,
      z: at.z,
      heading: at.facing,
      visible: loc.kind !== 'gone',
      path: null,
      s: 0,
      cursor: 0,
      leaving: false,
      seated: rest?.seated ?? false,
      clip: 'idle',
      prevClip: 'idle',
      blend: 1,
      time: hash(emp.id) * 10,
      phase: hash(emp.id + 'p') * 6,
      waveAt: -100,
      receiveAt: -100,
      look: null,
    };
    agent.clip = this.restClip(agent);
    agent.prevClip = agent.clip;
    return agent;
  }

  private moveTo(agent: Agent, emp: FloorEmployee, loc: FloorLocation) {
    const rest = this.spotFor(emp, loc);
    const { entrance } = this.layout;
    const jitter = (hash(agent.id + 'e') - 0.5) * 0.8;
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

    if (!agent.visible && rest) {
      // Arrives through the entrance.
      agent.x = entrance.x + jitter;
      agent.z = entrance.z;
      agent.heading = Math.PI;
      agent.visible = true;
    }
    const target = rest ?? { x: entrance.x + jitter, z: entrance.z + 0.2 };
    const path = this.paths.route(agent.x, agent.z, target.x, target.z);
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
  }

  private restClip(agent: Agent): ClipName {
    switch (agent.status) {
      case 'on_call':
        return 'phone';
      case 'busy':
        return 'typing';
      case 'away':
        return 'sleeping';
      default:
        return 'idle';
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
    return out.set(a.x, headTop(a.seated && !a.path) + 0.04, a.z);
  }

  positionOf(id: string): { x: number; z: number; visible: boolean } | null {
    const a = this.byId.get(id);
    return a ? { x: a.x, z: a.z, visible: a.visible } : null;
  }

  idAt(slot: number): string | null {
    return this.agents[slot]?.id ?? null;
  }

  isAtDesk(id: string): boolean {
    const a = this.byId.get(id);
    return !!a && a.visible && !a.path && a.location.kind === 'desk';
  }

  /** True when something moves (walks, turns, blends) and frames should keep coming. */
  get moving(): boolean {
    return this.agents.some((a) => a.path !== null || a.blend < 1 || a.look !== null || this.clock - a.waveAt < WAVE_S || this.clock - a.receiveAt < RECEIVE_S);
  }

  /** True when looping clips (typing, phone, breathing) would animate. */
  get ambient(): boolean {
    return !this.reducedMotion && this.agents.some((a) => a.visible);
  }

  update(dt: number) {
    this.clock += dt;
    const rm = this.reducedMotion;
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
        if (a.look) {
          if (this.clock > a.look.until) a.look = null;
          else {
            const toward = Math.atan2(a.look.x - a.x, a.look.z - a.z);
            let d = toward - face;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            face += Math.max(-1.1, Math.min(1.1, d));
          }
        }
        a.heading = rm ? face : angleLerp(a.heading, face, TURN_RATE * 0.6 * dt);
      }

      const clip: ClipName = a.path ? 'walking' : this.restClip(a);
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
      if (a.visible && !far) {
        const t = rm ? 0 : a.time;
        const seated = a.seated && !a.path;
        let p: PoseParams = evalClip(a.clip, t, a.phase, seated, scratchB);
        if (a.blend < 1) p = lerpParams(evalClip(a.prevClip, t, a.phase, seated, scratchA), p, easeInOut(a.blend), pose.params);
        else copyParams(p, pose.params);
        const wave = envelope(this.clock - a.waveAt, WAVE_S);
        if (wave > 0) applyWave(pose.params, this.clock, wave);
        const recv = envelope(this.clock - a.receiveAt, RECEIVE_S);
        if (recv > 0) applyReceive(pose.params, recv);
      } else if (a.visible) {
        evalClip(a.path ? 'walking' : 'idle', 0, 0, a.seated && !a.path, pose.params);
      }
      this.model.update(a.slot, pose);
    }
    this.model.commit();
  }
}

function sameLocation(a: FloorLocation, b: FloorLocation) {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'booth' && b.kind === 'booth') return a.index === b.index;
  if (a.kind === 'lounge' && b.kind === 'lounge') return a.index === b.index;
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

function copyParams(src: PoseParams, dst: PoseParams) {
  Object.assign(dst, src);
}
