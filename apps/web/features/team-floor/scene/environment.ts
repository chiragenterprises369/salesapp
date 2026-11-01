import * as THREE from 'three';
import type { FloorLayout, FurnitureKind, Spot } from '../state/layout';
import type { RoomId } from '../state/types';
import { FloorText } from './labels';
import type { LabelPalette, Surface } from './look';
import type { MaterialSet } from './materials';

/**
 * Static office: slab, instanced floor tiles per room, walls, glass, furniture, chairs, monitors,
 * plants, lamps, Lead Hub and room labels. Built once per layout; colours come from the shared
 * MaterialSet so theme tweens never touch geometry.
 */

const FURNITURE_SURFACE: Record<FurnitureKind, Surface> = {
  desk: 'desk',
  deskLeg: 'deskEdge',
  divider: 'divider',
  boothDesk: 'desk',
  boothPanel: 'divider',
  sofa: 'sofa',
  sofaBack: 'sofa',
  table: 'counter',
  shelf: 'shelf',
  counter: 'counter',
  appliance: 'appliance',
  cabinDesk: 'desk',
  rug: 'rug',
};

const ROOM_FLOOR: Record<Exclude<RoomId, 'hub'>, Surface> = {
  sales: 'floor',
  calling: 'floorCalling',
  cabin: 'floorCabin',
  lounge: 'floorLounge',
};

/** Screen-aligned yaw for floor text (camera yaw 45 deg). */
export const LABEL_YAW = Math.PI / 4;

export interface Environment {
  group: THREE.Group;
  setShadows(enabled: boolean): void;
  redrawLabels(labels: LabelPalette): void;
  dispose(): void;
}

const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function buildEnvironment(layout: FloorLayout, mats: MaterialSet): Environment {
  const group = new THREE.Group();
  group.name = 'environment';
  const geometries: THREE.BufferGeometry[] = [];
  const casters: THREE.Mesh[] = [];
  const labels: FloorText[] = [];

  const geo = <G extends THREE.BufferGeometry>(g: G) => {
    geometries.push(g);
    return g;
  };

  const instanced = (
    geometry: THREE.BufferGeometry,
    surface: Surface,
    matrices: THREE.Matrix4[],
    opts: { cast?: boolean; receive?: boolean; colors?: THREE.Color[] } = {},
  ) => {
    if (!matrices.length) return null;
    const mesh = new THREE.InstancedMesh(geometry, mats[surface], matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    if (opts.colors) opts.colors.forEach((col, i) => mesh.setColorAt(i, col));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = opts.receive ?? true;
    mesh.castShadow = opts.cast ?? false;
    if (opts.cast) casters.push(mesh);
    mesh.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    return mesh;
  };

  const place = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, yaw = 0) => {
    tmpQ.setFromAxisAngle(UP, yaw);
    tmpP.set(x, y, z);
    tmpS.set(sx, sy, sz);
    return new THREE.Matrix4().compose(tmpP, tmpQ, tmpS);
  };

  const W = layout.width;
  const D = layout.depth;

  // Slab (diorama base).
  const slab = new THREE.Mesh(geo(new THREE.BoxGeometry(W + 0.5, 0.42, D + 0.5)), mats.slab);
  slab.position.set(W / 2, -0.24, D / 2);
  slab.receiveShadow = true;
  group.add(slab);

  // Floor tiles, one instanced mesh per room surface, with a subtle checker.
  const tileGeo = geo(new THREE.BoxGeometry(0.982, 0.03, 0.982));
  const roomOf = (x: number, z: number): Exclude<RoomId, 'hub'> => {
    for (const r of layout.rooms) {
      if (r.id === 'hub') continue;
      if (x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.d) return r.id;
    }
    return 'sales';
  };
  const tiles: Record<Exclude<RoomId, 'hub'>, { m: THREE.Matrix4[]; c: THREE.Color[] }> = {
    sales: { m: [], c: [] },
    calling: { m: [], c: [] },
    cabin: { m: [], c: [] },
    lounge: { m: [], c: [] },
  };
  const light = new THREE.Color(1, 1, 1);
  const shade = new THREE.Color(0.965, 0.965, 0.965);
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const room = roomOf(x + 0.5, z + 0.5);
      tiles[room].m.push(place(x + 0.5, -0.015, z + 0.5));
      tiles[room].c.push((x + z) % 2 === 0 ? light : shade);
    }
  }
  for (const room of Object.keys(tiles) as Exclude<RoomId, 'hub'>[]) {
    instanced(tileGeo, ROOM_FLOOR[room], tiles[room].m, { colors: tiles[room].c });
  }

  // Walls: solid (with a darker cap), low front walls, glass with posts and rail.
  const unit = geo(new THREE.BoxGeometry(1, 1, 1));
  const solid: THREE.Matrix4[] = [];
  const caps: THREE.Matrix4[] = [];
  const low: THREE.Matrix4[] = [];
  const glass: THREE.Matrix4[] = [];
  const posts: THREE.Matrix4[] = [];
  for (const w of layout.walls) {
    const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
    const cx = (w.x1 + w.x2) / 2;
    const cz = (w.z1 + w.z2) / 2;
    const yaw = w.z1 === w.z2 ? 0 : Math.PI / 2;
    if (w.kind === 'glass') {
      glass.push(place(cx, w.h / 2, cz, len, w.h, 0.04, yaw));
      caps.push(place(cx, w.h + 0.015, cz, len, 0.03, 0.07, yaw));
      const n = Math.max(1, Math.round(len / 1.6));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        posts.push(place(w.x1 + (w.x2 - w.x1) * t, w.h / 2, w.z1 + (w.z2 - w.z1) * t, 0.06, w.h, 0.06));
      }
    } else if (w.kind === 'low') {
      low.push(place(cx, w.h / 2, cz, len + 0.12, w.h, 0.12, yaw));
    } else {
      solid.push(place(cx, w.h / 2, cz, len + 0.12, w.h, 0.12, yaw));
      caps.push(place(cx, w.h + 0.01, cz, len + 0.14, 0.02, 0.14, yaw));
    }
  }
  instanced(unit, 'wall', solid, { cast: true });
  instanced(unit, 'wallLow', caps);
  instanced(unit, 'wallLow', low, { cast: true });
  instanced(unit, 'deskEdge', posts, { cast: true });
  const glassMesh = instanced(unit, 'glass', glass, { receive: false });
  if (glassMesh) glassMesh.renderOrder = 2;

  // Furniture boxes grouped by surface.
  const bySurface = new Map<Surface, { m: THREE.Matrix4[]; cast: boolean }>();
  for (const f of layout.furniture) {
    const s = FURNITURE_SURFACE[f.kind];
    const entry = bySurface.get(s) ?? { m: [], cast: false };
    entry.m.push(place(f.x, f.y + f.h / 2, f.z, f.w, f.h, f.d));
    entry.cast ||= f.kind !== 'rug';
    bySurface.set(s, entry);
  }
  for (const [s, entry] of bySurface) instanced(unit, s, entry.m, { cast: entry.cast });

  // Chairs (desk, booth, cabin, visitors).
  const chairs: Spot[] = [...layout.desks, ...layout.booths, layout.cabinSeat, ...layout.spareChairs];
  const seat: THREE.Matrix4[] = [];
  const back: THREE.Matrix4[] = [];
  const post: THREE.Matrix4[] = [];
  const base: THREE.Matrix4[] = [];
  for (const c of chairs) {
    const bx = c.x - Math.sin(c.facing) * 0.22;
    const bz = c.z - Math.cos(c.facing) * 0.22;
    seat.push(place(c.x, 0.37, c.z, 0.44, 0.06, 0.44, c.facing));
    back.push(place(bx, 0.62, bz, 0.42, 0.42, 0.06, c.facing));
    post.push(place(c.x, 0.18, c.z));
    base.push(place(c.x, 0.02, c.z));
  }
  instanced(unit, 'chair', seat, { cast: true });
  instanced(unit, 'chair', back, { cast: true });
  instanced(geo(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 6)), 'deskEdge', post);
  instanced(geo(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 10)), 'chair', base);

  // Monitors: frame + emissive screen + keyboard.
  const frames: THREE.Matrix4[] = [];
  const screens: THREE.Matrix4[] = [];
  const stands: THREE.Matrix4[] = [];
  const keyboards: THREE.Matrix4[] = [];
  for (const m of layout.monitors) {
    const fx = Math.sin(m.facing);
    const fz = Math.cos(m.facing);
    frames.push(place(m.x, m.y + 0.42, m.z, 0.62, 0.38, 0.035, m.facing));
    screens.push(place(m.x + fx * 0.02, m.y + 0.42, m.z + fz * 0.02, 0.56, 0.32, 0.01, m.facing));
    stands.push(place(m.x - fx * 0.03, m.y + 0.12, m.z - fz * 0.03, 0.05, 0.24, 0.05, m.facing));
    keyboards.push(place(m.x + fx * 0.32, m.y + 0.012, m.z + fz * 0.32, 0.42, 0.018, 0.13, m.facing));
  }
  instanced(unit, 'monitor', frames, { cast: true });
  instanced(unit, 'screen', screens, { receive: false });
  instanced(unit, 'monitor', stands);
  instanced(unit, 'divider', keyboards);

  // Plants.
  const pots: THREE.Matrix4[] = [];
  const leaves: THREE.Matrix4[] = [];
  for (const p of layout.plants) {
    pots.push(place(p.x, 0.16 * p.s, p.z, p.s, p.s, p.s));
    leaves.push(place(p.x, (0.32 + 0.24) * p.s, p.z, p.s, p.s * 1.15, p.s, p.x * 1.7));
  }
  instanced(geo(new THREE.CylinderGeometry(0.17, 0.13, 0.32, 8)), 'plantPot', pots, { cast: true });
  instanced(geo(new THREE.IcosahedronGeometry(0.3, 0)), 'plant', leaves, { cast: true });

  // Lamps (desk lamps on dividers, a floor lamp in the lounge).
  const stems: THREE.Matrix4[] = [];
  const shades: THREE.Matrix4[] = [];
  for (const l of layout.lamps) {
    const h = 0.3 * l.scale;
    stems.push(place(l.x, l.y + h / 2, l.z, l.scale * 0.5 + 0.5, l.scale, l.scale * 0.5 + 0.5));
    shades.push(place(l.x, l.y + h + 0.05 * l.scale, l.z, l.scale, l.scale, l.scale));
  }
  instanced(geo(new THREE.CylinderGeometry(0.015, 0.02, 0.3, 5)), 'lampStem', stems);
  instanced(geo(new THREE.CylinderGeometry(0.05, 0.12, 0.12, 10, 1, true)), 'lampShade', shades);

  // Lead Hub: platform, glowing rings, pedestal.
  const { hub } = layout;
  const platform = new THREE.Mesh(geo(new THREE.CylinderGeometry(hub.r, hub.r, 0.05, 40)), mats.hubBase);
  platform.position.set(hub.x, 0.025, hub.z);
  platform.receiveShadow = true;
  const outer = new THREE.Mesh(geo(new THREE.TorusGeometry(hub.r - 0.04, 0.035, 6, 64)), mats.hubRing);
  outer.rotation.x = -Math.PI / 2;
  outer.position.set(hub.x, 0.055, hub.z);
  const inner = new THREE.Mesh(geo(new THREE.TorusGeometry(1.25, 0.012, 4, 48)), mats.hubRing);
  inner.rotation.x = -Math.PI / 2;
  inner.position.set(hub.x, 0.055, hub.z);
  const pedestal = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.42, 0.5, 0.5, 20)), mats.hubTop);
  pedestal.position.set(hub.x, 0.3, hub.z);
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  casters.push(pedestal);
  const disc = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.34, 0.34, 0.02, 24)), mats.hubRing);
  disc.position.set(hub.x, 0.56, hub.z);
  group.add(platform, outer, inner, pedestal, disc);

  // Room labels painted on the floor (in open floor near each room's front).
  const roomLabel = (id: RoomId, x: number, z: number, yaw = LABEL_YAW) => {
    const room = layout.rooms.find((r) => r.id === id);
    if (!room) return;
    const t = new FloorText(room.label, x, z, yaw);
    labels.push(t);
    group.add(t.mesh);
  };
  const cabin = layout.rooms.find((r) => r.id === 'cabin');
  const lounge = layout.rooms.find((r) => r.id === 'lounge');
  const calling = layout.rooms.find((r) => r.id === 'calling');
  if (cabin) roomLabel('cabin', 5.8, 1.15);
  if (lounge) roomLabel('lounge', 6.0, lounge.z + lounge.d - 1.7);
  if (calling) roomLabel('calling', calling.x + 1.05, calling.d / 2 + 3.2, Math.PI / 2);
  roomLabel('hub', hub.x + 0.3, hub.z + hub.r + 0.8);

  return {
    group,
    setShadows(enabled) {
      for (const m of casters) m.castShadow = enabled;
    },
    redrawLabels(palette) {
      for (const l of labels) l.draw(palette);
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const l of labels) l.dispose();
      group.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
    },
  };
}
