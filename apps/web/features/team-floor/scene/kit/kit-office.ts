import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FloorLayout } from '../../state/layout';
import { KIT_MONITOR, PLAN_FLOOR } from '../../state/layout/kit';
import { GlowLayer } from '../glow';
import { ART, type LabelPalette, type Look } from '../look';
import { screenTexture, type OfficeView } from '../office';
import { FloorAmbience } from './ambience';
import { kitParts, MONITOR_SCREEN, PART_COLOR, type PartGeo, type PartMat } from './items';
import { floorTexture, type FloorFinish } from './textures';

/**
 * Office built from a published floor plan (format `layout_json`) with the module kit: textured room
 * floors, walls with door openings (outer back walls full height, front walls low, inner walls cut
 * away or glass, so the fixed isometric camera sees every room), instanced furniture, chairs and
 * monitors per seat, the Lead Hub and lamps. Everything is lit in realtime by the engine's
 * hemisphere, key and fill lights; `setLook` tints it towards the Evening look, where warm lamp
 * pools, point lights and glowing screens take over (FloorAmbience, GlowLayer).
 */

const RAD = Math.PI / 180;
const WALL_COLOR = { back: ART.paint, front: ART.slate, partition: '#e9e3d8', glass: ART.glass, glass_walnut: ART.glass } as const;

export class KitOffice implements OfficeView {
  readonly group = new THREE.Group();
  private readonly owned: { dispose(): void }[] = [];
  private readonly lit: { mat: THREE.MeshLambertMaterial; base: THREE.Color }[] = [];
  private readonly glassMats: THREE.MeshLambertMaterial[] = [];
  private readonly accent: THREE.MeshBasicMaterial;
  private screens: THREE.InstancedMesh | null = null;
  private readonly screenIndex = new Map<string, number>();
  private readonly screenOn: number[] = [];
  private readonly screenMat: THREE.MeshBasicMaterial;
  private readonly screenLight: THREE.CanvasTexture;
  private readonly screenDark: THREE.CanvasTexture;
  private darkScreens = false;
  private readonly screenColor = new THREE.Color('#eef3ff');
  private screenLevel = 1;
  private readonly tmp = new THREE.Color();
  private readonly glow: GlowLayer;
  private readonly ambience: FloorAmbience;
  readonly instanced: THREE.InstancedMesh[] = [];

  constructor(layout: FloorLayout) {
    this.group.name = 'kit-office';
    const t = layout.template;
    const own = <T extends { dispose(): void }>(x: T) => {
      this.owned.push(x);
      return x;
    };
    const lambert = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) => {
      const mat = own(new THREE.MeshLambertMaterial({ color, ...extra }));
      this.lit.push({ mat, base: mat.color.clone() });
      return mat;
    };

    // Slab and base floor.
    const shape = new THREE.Shape(layout.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
    const slab = own(new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false }));
    slab.rotateX(-Math.PI / 2);
    const slabMesh = new THREE.Mesh(slab, lambert(ART.slate));
    slabMesh.position.y = -0.3;
    this.group.add(slabMesh);
    const finishes = new Map<FloorFinish, THREE.MeshLambertMaterial>();
    const finishMat = (f: FloorFinish) => {
      let m = finishes.get(f);
      if (!m) {
        m = lambert('#ffffff', { map: floorTexture(f) });
        finishes.set(f, m);
      }
      return m;
    };
    const base = PLAN_FLOOR[t.custom?.floorMaterial ?? 'wood'];
    const baseGeo = own(new THREE.ShapeGeometry(shape));
    baseGeo.rotateX(-Math.PI / 2);
    const baseMesh = new THREE.Mesh(baseGeo, finishMat(base));
    baseMesh.position.y = 0.001;
    baseMesh.receiveShadow = true;
    this.group.add(baseMesh);

    // Room floors, merged per finish; later rooms sit a hair higher (drawn on top where they overlap).
    const roomGeos = new Map<FloorFinish, THREE.BufferGeometry[]>();
    t.rooms.forEach((r, i) => {
      if (r.id === '__open') return;
      const g = new THREE.ShapeGeometry(new THREE.Shape(r.outline.map(([x, z]) => new THREE.Vector2(x, -z))));
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0.002 + i * 0.0004, 0);
      const list = roomGeos.get(r.floor);
      if (list) list.push(g);
      else roomGeos.set(r.floor, [g]);
    });
    for (const [finish, geos] of roomGeos) {
      const merged = geos.length > 1 ? mergeGeometries(geos) : geos[0]!;
      if (geos.length > 1) geos.forEach((g) => g.dispose());
      if (!merged) continue;
      own(merged);
      const mesh = new THREE.Mesh(merged, finishMat(finish));
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    // Walls (door openings cut), merged per wall kind; glass walls get a slim top rail.
    const wallGeos = new Map<keyof typeof WALL_COLOR | 'rail', THREE.BufferGeometry[]>();
    const push = (k: keyof typeof WALL_COLOR | 'rail', g: THREE.BufferGeometry) => {
      const list = wallGeos.get(k);
      if (list) list.push(g);
      else wallGeos.set(k, [g]);
    };
    for (const w of t.walls) {
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      if (len < 0.05) continue;
      const ux = (w.b[0] - w.a[0]) / len;
      const uz = (w.b[1] - w.a[1]) / len;
      const ry = -Math.atan2(uz, ux);
      let cursor = 0;
      const cuts = w.openings.filter((o) => o.kind !== 'window').sort((p, q) => p.from - q.from);
      for (const o of [...cuts, { from: len, to: len }]) {
        if (o.from > cursor + 0.01) {
          const seg = o.from - cursor;
          const cx = w.a[0] + ux * (cursor + seg / 2);
          const cz = w.a[1] + uz * (cursor + seg / 2);
          const glass = w.kind === 'glass' || w.kind === 'glass_walnut';
          const g = new THREE.BoxGeometry(seg, w.height, w.thickness);
          g.rotateY(ry);
          g.translate(cx, w.height / 2, cz);
          push(w.kind, g);
          if (glass) {
            const rail = new THREE.BoxGeometry(seg, 0.05, w.thickness + 0.03);
            rail.rotateY(ry);
            rail.translate(cx, w.height, cz);
            push('rail', rail);
          }
        }
        cursor = Math.max(cursor, o.to);
      }
    }
    for (const [kind, geos] of wallGeos) {
      const merged = geos.length > 1 ? mergeGeometries(geos) : geos[0]!;
      if (geos.length > 1) geos.forEach((g) => g.dispose());
      if (!merged) continue;
      own(merged);
      const glass = kind === 'glass' || kind === 'glass_walnut';
      const mat = glass ? own(new THREE.MeshLambertMaterial({ color: WALL_COLOR[kind], transparent: true, opacity: 0.2, depthWrite: false })) : lambert(kind === 'rail' ? ART.slate : WALL_COLOR[kind]);
      if (glass) this.glassMats.push(mat);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = !glass;
      mesh.receiveShadow = true;
      if (glass) mesh.renderOrder = 2;
      this.group.add(mesh);
    }

    // Furniture, chairs and monitors: one InstancedMesh per (primitive, material) for the whole floor.
    const unit: Record<PartGeo, THREE.BufferGeometry> = {
      box: own(new THREE.BoxGeometry(1, 1, 1)),
      cyl: own(new THREE.CylinderGeometry(1, 1, 1, 16)),
      ico: own(new THREE.IcosahedronGeometry(1, 1)),
    };
    this.accent = own(new THREE.MeshBasicMaterial({ color: '#4d6dff', toneMapped: false }));
    const partMats = new Map<PartMat, THREE.Material>();
    const partMat = (m: PartMat): THREE.Material => {
      let mat = partMats.get(m);
      if (!mat) {
        if (m === 'accent') mat = this.accent;
        else if (m === 'glass' || m === 'water') {
          const g = own(new THREE.MeshLambertMaterial({ color: PART_COLOR[m], transparent: true, opacity: m === 'water' ? 0.6 : 0.22, depthWrite: false }));
          if (m === 'glass') this.glassMats.push(g);
          mat = g;
        } else mat = lambert(PART_COLOR[m]);
        partMats.set(m, mat);
      }
      return mat;
    };
    const groups = new Map<string, { geo: PartGeo; mat: PartMat; matrices: THREE.Matrix4[] }>();
    const item = new THREE.Matrix4();
    const part = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const screenMatrices: { id: string; m: THREE.Matrix4 }[] = [];
    for (const p of t.props) {
      const parts = kitParts(p.type);
      if (!parts.length) continue;
      item.compose(new THREE.Vector3(p.pos[0], p.y ?? 0, p.pos[1]), q.setFromAxisAngle(up, p.facing * RAD), new THREE.Vector3(1, 1, 1));
      for (const pt of parts) {
        const key = `${pt.geo}:${pt.mat}`;
        let g = groups.get(key);
        if (!g) {
          g = { geo: pt.geo, mat: pt.mat, matrices: [] };
          groups.set(key, g);
        }
        part.compose(new THREE.Vector3(...pt.pos), new THREE.Quaternion().setFromAxisAngle(up, pt.rotY ?? 0), new THREE.Vector3(...pt.size));
        g.matrices.push(item.clone().multiply(part));
      }
      if (p.type === KIT_MONITOR && p.screen) {
        part.compose(new THREE.Vector3(...MONITOR_SCREEN.pos), new THREE.Quaternion(), new THREE.Vector3(MONITOR_SCREEN.w, MONITOR_SCREEN.h, 1));
        screenMatrices.push({ id: p.screen, m: item.clone().multiply(part) });
      }
    }
    for (const [key, g] of groups) {
      const mesh = new THREE.InstancedMesh(unit[g.geo], partMat(g.mat), g.matrices.length);
      g.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = `kit:${key}`;
      const see = g.mat === 'glass' || g.mat === 'water';
      mesh.castShadow = !see && g.mat !== 'accent';
      mesh.receiveShadow = true;
      if (see) mesh.renderOrder = 2;
      this.instanced.push(mesh);
      this.group.add(mesh);
    }

    // Monitor screens: one instanced quad set, per-seat brightness as instance colours.
    this.screenLight = own(screenTexture(false));
    this.screenDark = own(screenTexture(true));
    this.screenLight.flipY = true;
    this.screenDark.flipY = true;
    this.screenMat = own(new THREE.MeshBasicMaterial({ color: '#ffffff', map: this.screenLight }));
    const quad = own(new THREE.PlaneGeometry(1, 1));
    const screenNodes = new Map<string, THREE.Mesh>();
    if (screenMatrices.length) {
      const mesh = new THREE.InstancedMesh(quad, this.screenMat, screenMatrices.length);
      screenMatrices.forEach(({ id, m }, i) => {
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, this.screenColor);
        this.screenIndex.set(id, i);
        this.screenOn.push(1);
        // Stand-in node per screen for the glow layer (never rendered).
        const node = new THREE.Mesh(quad);
        node.matrixAutoUpdate = false;
        node.matrix.copy(m);
        node.matrixWorld.copy(m);
        screenNodes.set(id, node);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = 'kit:screens';
      this.screens = mesh;
      this.group.add(mesh);
    }

    this.glow = own(new GlowLayer(t, screenNodes));
    this.group.add(this.glow.group);
    this.ambience = own(new FloorAmbience(layout, { hub: true }));
    this.group.add(this.ambience.group);
  }

  setLook(look: Look) {
    // Evening: the cool, dimmed tint of the realtime props in the baked offices, a little darker overall.
    const dim = 1 - 0.16 * look.lightMix;
    for (const { mat, base } of this.lit) mat.color.copy(base).multiply(look.propTint).multiplyScalar(dim);
    for (const g of this.glassMats) g.opacity = look.glassOpacity + 0.06;
    this.accent.color.copy(look.reception).multiplyScalar(look.receptionLevel);
    this.screenColor.copy(look.screen);
    this.screenLevel = look.screenLevel;
    const dark = look.lightMix > 0.5;
    if (dark !== this.darkScreens) {
      this.darkScreens = dark;
      this.screenMat.map = dark ? this.screenDark : this.screenLight;
      this.screenMat.needsUpdate = true;
    }
    for (const i of this.screenIndex.values()) this.paint(i, this.screenOn[i] ?? 1);
    this.glow.setLevel(look.glowLevel);
    this.ambience.setLook(look);
  }

  setGlowEnabled(on: boolean) {
    this.glow.setEnabled(on);
  }

  setScreen(seatId: string, level: number) {
    const i = this.screenIndex.get(seatId);
    if (i === undefined || this.screenOn[i] === level) return;
    this.screenOn[i] = level;
    this.paint(i, level);
    this.glow.setScreen(seatId, level);
  }

  private paint(i: number, on: number) {
    if (!this.screens) return;
    this.tmp.set('#161b23').lerp(this.screenColor.clone().multiplyScalar(this.screenLevel), on);
    this.screens.setColorAt(i, this.tmp);
    if (this.screens.instanceColor) this.screens.instanceColor.needsUpdate = true;
  }

  drawHub(palette: LabelPalette, waiting: number) {
    this.ambience.drawHub(palette, waiting);
  }

  dispose() {
    for (const o of this.owned) o.dispose();
    for (const i of this.instanced) i.dispose();
    this.screens?.dispose();
  }
}
