import type { AvatarConfig } from '@vistar/shared';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Look } from './look';

/**
 * Character rendering behind a `CharacterModel` interface. Two implementations:
 * - `createGlbCharacters` (character-glb.ts): rigged GLB people with clips (default),
 * - `createProceduralCharacters` (below): ~14 instanced meshes for everyone, used as the fallback
 *   when the GLB cannot load and for very large stress floors (200 people = ~14 draw calls).
 */

export type ClipName = 'idle' | 'sit' | 'typing' | 'phone' | 'walking' | 'carry' | 'sleeping' | 'wave' | 'receive';
export type LodLevel = 'near' | 'mid' | 'far';
export type PropName = 'none' | 'phone' | 'document';

export interface CharacterPose {
  x: number;
  z: number;
  heading: number;
  visible: boolean;
  seated: boolean;
  /** Clip the person should play (GLB crossfades to it). */
  clip: ClipName;
  prop: PropName;
  /** Joint parameters (procedural model only). */
  params: PoseParams;
}

export interface PoseParams {
  hip: number;
  lean: number;
  breathe: number;
  legL: number;
  legR: number;
  armLPitch: number;
  armLRoll: number;
  armRPitch: number;
  armRRoll: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  phone: number;
}

export interface CharacterModel {
  readonly kind: 'glb' | 'procedural';
  readonly object: THREE.Object3D;
  readonly capacity: number;
  /** World height of the head top. */
  headTop(seated: boolean): number;
  setAppearance(slot: number, avatar: AvatarConfig | null, userId: string): void;
  /** Floor ring colour; shown only when `show` (active calls). */
  setStatusColor(slot: number, color: THREE.Color, show: boolean): void;
  update(slot: number, pose: CharacterPose, dt: number): void;
  /** Upload instance matrices after a batch of updates. */
  commit(): void;
  setLod(level: LodLevel): void;
  setShadows(cast: boolean): void;
  /** Thin outline for separation (tier-gated); `zoom` = px per metre keeps it ~1 px wide. */
  setOutline(on: boolean, zoom: number): void;
  setReducedMotion(on: boolean): void;
  setLook(look: Look): void;
  /** Slot under the ray, or -1. */
  pick(raycaster: THREE.Raycaster): number;
  dispose(): void;
}

export const STANDING_HIP = 0.46;
export const SEATED_HIP = 0.36;
/** Uniform character scale (metric office: desks 0.75 m, chairs 0.47 m). */
export const CHAR_SCALE = 1.3;
/** Head top above the hip in model units. */
const HEAD_ABOVE_HIP = 0.88;

/** World height of the head top. */
export function headTop(seated: boolean) {
  return CHAR_SCALE * ((seated ? SEATED_HIP : STANDING_HIP) + HEAD_ABOVE_HIP);
}

export function emptyParams(): PoseParams {
  return {
    hip: STANDING_HIP,
    lean: 0,
    breathe: 1,
    legL: 0,
    legR: 0,
    armLPitch: 0,
    armLRoll: 0,
    armRPitch: 0,
    armRRoll: 0,
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    phone: 0,
  };
}

export function lerpParams(a: PoseParams, b: PoseParams, t: number, out: PoseParams): PoseParams {
  out.hip = a.hip + (b.hip - a.hip) * t;
  out.lean = a.lean + (b.lean - a.lean) * t;
  out.breathe = a.breathe + (b.breathe - a.breathe) * t;
  out.legL = a.legL + (b.legL - a.legL) * t;
  out.legR = a.legR + (b.legR - a.legR) * t;
  out.armLPitch = a.armLPitch + (b.armLPitch - a.armLPitch) * t;
  out.armLRoll = a.armLRoll + (b.armLRoll - a.armLRoll) * t;
  out.armRPitch = a.armRPitch + (b.armRPitch - a.armRPitch) * t;
  out.armRRoll = a.armRRoll + (b.armRRoll - a.armRRoll) * t;
  out.headPitch = a.headPitch + (b.headPitch - a.headPitch) * t;
  out.headYaw = a.headYaw + (b.headYaw - a.headYaw) * t;
  out.headRoll = a.headRoll + (b.headRoll - a.headRoll) * t;
  out.phone = t < 0.5 ? a.phone : b.phone;
  return out;
}

/**
 * Procedural clips as poses. `t` = clip time (s), `phase` desyncs characters. Right arm is the
 * character's right (-x in local space, the model faces +z).
 */
export function evalClip(clip: ClipName, t: number, phase: number, seated: boolean, out: PoseParams): PoseParams {
  const sitLegs = -Math.PI / 2 + 0.12;
  out.phone = 0;
  out.headRoll = 0;
  out.armLRoll = 0.08;
  out.armRRoll = -0.08;
  switch (clip) {
    case 'carry':
    case 'walking': {
      const w = Math.sin((t + phase) * Math.PI * 2 * 1.9);
      out.hip = STANDING_HIP + 0.022 * Math.abs(Math.cos((t + phase) * Math.PI * 2 * 1.9));
      out.lean = 0.05;
      out.breathe = 1;
      out.legL = 0.55 * w;
      out.legR = -0.55 * w;
      out.armLPitch = -0.45 * w;
      out.armRPitch = 0.45 * w;
      out.headPitch = 0.04;
      out.headYaw = 0;
      break;
    }
    case 'typing': {
      const k = Math.sin((t + phase) * 17);
      out.hip = SEATED_HIP;
      out.lean = 0.12;
      out.breathe = 1 + 0.01 * Math.sin((t + phase) * 1.8);
      out.legL = sitLegs;
      out.legR = sitLegs;
      out.armLPitch = -1.05 + 0.07 * k;
      out.armRPitch = -1.05 - 0.07 * k;
      out.armLRoll = 0.22;
      out.armRRoll = -0.22;
      out.headPitch = 0.14 + 0.03 * Math.sin((t + phase) * 0.9);
      out.headYaw = 0.06 * Math.sin((t + phase) * 0.35);
      break;
    }
    case 'phone': {
      const g = Math.sin((t + phase) * 1.3);
      out.hip = seated ? SEATED_HIP : STANDING_HIP;
      out.lean = seated ? 0.02 : 0;
      out.breathe = 1 + 0.012 * Math.sin((t + phase) * 2.1);
      out.legL = seated ? sitLegs : 0;
      out.legR = seated ? sitLegs + 0.08 : 0;
      out.armRPitch = -2.82;
      out.armRRoll = 0.18;
      out.armLPitch = -0.55 - 0.35 * Math.max(0, g);
      out.armLRoll = 0.15 + 0.1 * Math.max(0, g);
      out.headPitch = 0.05;
      out.headYaw = 0.2 * Math.sin((t + phase) * 0.5);
      out.headRoll = -0.14;
      out.phone = 1;
      break;
    }
    case 'sleeping': {
      const b = Math.sin((t + phase) * 1.1);
      out.hip = seated ? SEATED_HIP - 0.02 : STANDING_HIP;
      out.lean = seated ? -0.28 : 0;
      out.breathe = 1 + 0.025 * b;
      out.legL = seated ? sitLegs + 0.15 : 0;
      out.legR = seated ? sitLegs + 0.1 : 0;
      out.armLPitch = -0.35;
      out.armRPitch = -0.4;
      out.armLRoll = 0.25;
      out.armRRoll = -0.25;
      out.headPitch = 0.38;
      out.headYaw = 0;
      out.headRoll = 0.32;
      break;
    }
    case 'idle':
    default: {
      out.hip = seated ? SEATED_HIP : STANDING_HIP;
      out.lean = seated ? 0.02 : 0;
      out.breathe = 1 + 0.015 * Math.sin((t + phase) * 1.6);
      out.legL = seated ? sitLegs : 0;
      out.legR = seated ? sitLegs : 0;
      out.armLPitch = seated ? -0.75 : -0.06;
      out.armRPitch = seated ? -0.75 : -0.06;
      out.armLRoll = seated ? 0.2 : 0.08;
      out.armRRoll = seated ? -0.2 : -0.08;
      out.headPitch = 0.02;
      out.headYaw = 0.35 * Math.sin((t + phase) * 0.33) * Math.sin((t + phase * 3) * 0.17);
      break;
    }
  }
  return out;
}

/** Overlay a wave (right arm up, waving) with weight w. */
export function applyWave(p: PoseParams, t: number, w: number) {
  if (w <= 0) return;
  p.armRPitch += (-2.9 - p.armRPitch) * w;
  p.armRRoll += (-0.25 + 0.35 * Math.sin(t * 13) - p.armRRoll) * w;
  p.headYaw += (0.15 - p.headYaw) * w;
}

/** Overlay "receive a parcel": both arms forward. */
export function applyReceive(p: PoseParams, w: number) {
  if (w <= 0) return;
  p.armLPitch += (-1.45 - p.armLPitch) * w;
  p.armRPitch += (-1.45 - p.armRPitch) * w;
  p.armLRoll += (0.3 - p.armLRoll) * w;
  p.armRRoll += (-0.3 - p.armRRoll) * w;
  p.lean += (0.16 - p.lean) * w;
  p.phone = 0;
}

// ---------------------------------------------------------------- procedural implementation

type HairStyle = AvatarConfig['hairStyle'];
const HAIR_STYLES: HairStyle[] = ['short', 'long', 'bun', 'curly', 'bald'];

const DEFAULT_AVATAR: AvatarConfig = { skinTone: '#C68642', hairColor: '#1F1A17', hairStyle: 'short', outfitColor: '#64748B' };

function hairGeometry(style: HairStyle): THREE.BufferGeometry | null {
  const ni = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
  const cap = () => {
    const g = new THREE.SphereGeometry(0.182, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.52);
    g.translate(0, 0.17 + 0.012, -0.012);
    return g;
  };
  switch (style) {
    case 'bald':
      return null;
    case 'short':
      return cap();
    case 'long': {
      const back = new THREE.BoxGeometry(0.34, 0.34, 0.09);
      back.translate(0, 0.08, -0.12);
      return mergeGeometries([ni(cap()), ni(back)]);
    }
    case 'bun': {
      const bun = new THREE.IcosahedronGeometry(0.085, 0);
      bun.translate(0, 0.36, -0.07);
      return mergeGeometries([ni(cap()), ni(bun)]);
    }
    case 'curly': {
      const parts: THREE.BufferGeometry[] = [ni(cap())];
      const curls: [number, number, number][] = [
        [0, 0.34, 0],
        [0.11, 0.3, 0.06],
        [-0.11, 0.3, 0.06],
        [0.13, 0.27, -0.07],
        [-0.13, 0.27, -0.07],
        [0, 0.3, -0.13],
        [0.06, 0.33, 0.1],
        [-0.06, 0.33, 0.1],
      ];
      for (const [x, y, z] of curls) {
        const s = new THREE.IcosahedronGeometry(0.075, 0);
        s.translate(x, y, z);
        parts.push(ni(s));
      }
      return mergeGeometries(parts);
    }
  }
}

interface Part {
  mesh: THREE.InstancedMesh;
  /** Instances per character. */
  per: number;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export function createProceduralCharacters(capacity: number, materials: { blob: THREE.Material; phone: THREE.Material }): CharacterModel {
  const cap = Math.max(1, capacity);
  const group = new THREE.Group();
  group.name = 'characters';
  const geometries: THREE.BufferGeometry[] = [];
  const materialsOwned: THREE.Material[] = [];
  const parts: Part[] = [];

  const mat = (opts: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, flatShading: true, ...opts });
    materialsOwned.push(m);
    return m;
  };
  const make = (geometry: THREE.BufferGeometry, material: THREE.Material, per = 1, shadow = true) => {
    geometries.push(geometry);
    const mesh = new THREE.InstancedMesh(geometry, material, cap * per);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = shadow;
    mesh.receiveShadow = false;
    for (let i = 0; i < cap * per; i++) mesh.setMatrixAt(i, ZERO);
    group.add(mesh);
    const part = { mesh, per };
    parts.push(part);
    return part;
  };

  const outfitMat = mat();
  const skinMat = mat();
  const hairMat = mat({ roughness: 0.95 });
  const legMat = mat();

  const legGeo = new THREE.CapsuleGeometry(0.072, 0.3, 2, 6);
  legGeo.translate(0, -0.222, 0);
  const torsoGeo = new THREE.CapsuleGeometry(0.17, 0.2, 3, 8);
  torsoGeo.translate(0, 0.27, 0);
  const headGeo = new THREE.IcosahedronGeometry(0.17, 1);
  headGeo.translate(0, 0.17, 0);
  const armGeo = new THREE.CapsuleGeometry(0.052, 0.27, 2, 6);
  armGeo.translate(0, -0.187, 0);
  const handGeo = new THREE.IcosahedronGeometry(0.058, 0);
  handGeo.translate(0, -0.39, 0);
  const phoneGeo = new THREE.BoxGeometry(0.05, 0.12, 0.022);
  phoneGeo.translate(0.035, -0.4, 0.02);
  const blobGeo = new THREE.CircleGeometry(0.34, 18);
  blobGeo.rotateX(-Math.PI / 2);
  blobGeo.translate(0, 0.008, 0);
  const statusGeo = new THREE.RingGeometry(0.36, 0.43, 28);
  statusGeo.rotateX(-Math.PI / 2);
  statusGeo.translate(0, 0.012, 0);
  const proxyGeo = new THREE.CylinderGeometry(0.32, 0.32, 1.3, 8);
  proxyGeo.translate(0, 0.65, 0);

  const legs = make(legGeo, legMat, 2);
  const torso = make(torsoGeo, outfitMat);
  const head = make(headGeo, skinMat);
  const arms = make(armGeo, outfitMat, 2);
  const hands = make(handGeo, skinMat, 2);
  const phone = make(phoneGeo, materials.phone);
  const hair = new Map<HairStyle, Part>();
  for (const style of HAIR_STYLES) {
    const g = hairGeometry(style);
    if (g) hair.set(style, make(g, hairMat));
  }
  const blob = make(blobGeo, materials.blob, 1, false);
  blob.mesh.renderOrder = 1;
  const statusMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  materialsOwned.push(statusMat);
  const status = make(statusGeo, statusMat, 1, false);
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  materialsOwned.push(proxyMat);
  const proxy = make(proxyGeo, proxyMat, 1, false);
  proxy.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

  const styles: (HairStyle | null)[] = new Array(cap).fill(null);
  /** Compact instance index per hair style, so each style mesh draws only its own people. */
  const styleIndex = new Int32Array(cap).fill(-1);
  const styleCount = new Map<HairStyle, number>();
  for (const part of hair.values()) part.mesh.count = 0;

  // Scratch objects (no allocation per frame).
  const root = new THREE.Matrix4();
  const torsoM = new THREE.Matrix4();
  const headM = new THREE.Matrix4();
  const armLM = new THREE.Matrix4();
  const armRM = new THREE.Matrix4();
  const m = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  const one = new THREE.Vector3(CHAR_SCALE, CHAR_SCALE, CHAR_SCALE);
  let lod: LodLevel = 'near';

  const setLocal = (x: number, y: number, z: number, rx: number, ry: number, rz: number, sx = 1, sy = 1, sz = 1) => {
    e.set(rx, ry, rz, 'XYZ');
    q.setFromEuler(e);
    v.set(x, y, z);
    s.set(sx, sy, sz);
    return local.compose(v, q, s);
  };

  const statusShown = new Uint8Array(cap);
  const model: CharacterModel = {
    kind: 'procedural',
    object: group,
    capacity: cap,
    headTop,
    setOutline() {},
    setReducedMotion() {},
    setLook() {},
    setAppearance(slot, avatar) {
      const a = avatar ?? DEFAULT_AVATAR;
      const outfit = new THREE.Color(a.outfitColor);
      const skin = new THREE.Color(a.skinTone);
      const hairC = new THREE.Color(a.hairColor);
      const trousers = outfit.clone().multiplyScalar(0.42);
      torso.mesh.setColorAt(slot, outfit);
      head.mesh.setColorAt(slot, skin);
      for (let k = 0; k < 2; k++) {
        arms.mesh.setColorAt(slot * 2 + k, outfit);
        hands.mesh.setColorAt(slot * 2 + k, skin);
        legs.mesh.setColorAt(slot * 2 + k, trousers);
      }
      for (const p of [torso, head, arms, hands, legs]) if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      // Hair: one compact instance in the mesh for this person's style (assigned once per slot).
      if (styles[slot] === null) {
        const part = hair.get(a.hairStyle);
        if (part) {
          const n = styleCount.get(a.hairStyle) ?? 0;
          styleCount.set(a.hairStyle, n + 1);
          styleIndex[slot] = n;
          part.mesh.count = n + 1;
          part.mesh.setColorAt(n, hairC);
          if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
        }
        styles[slot] = a.hairStyle;
      }
    },
    setStatusColor(slot, color, show) {
      statusShown[slot] = show ? 1 : 0;
      status.mesh.setColorAt(slot, color);
      if (status.mesh.instanceColor) status.mesh.instanceColor.needsUpdate = true;
    },
    update(slot, pose) {
      const style = styles[slot];
      const hairPart = style && style !== 'bald' ? hair.get(style) : undefined;
      const hairSlot = styleIndex[slot] ?? -1;
      if (!pose.visible) {
        for (const p of [legs, torso, head, arms, hands, phone, blob, status, proxy]) for (let k = 0; k < p.per; k++) p.mesh.setMatrixAt(slot * p.per + k, ZERO);
        if (hairPart && hairSlot >= 0) hairPart.mesh.setMatrixAt(hairSlot, ZERO);
        return;
      }
      const P = pose.params;
      q.setFromAxisAngle(v.set(0, 1, 0), pose.heading);
      root.compose(v.set(pose.x, 0, pose.z), q, one);

      blob.mesh.setMatrixAt(slot, root);
      status.mesh.setMatrixAt(slot, statusShown[slot] ? root : ZERO);
      proxy.mesh.setMatrixAt(slot, root);

      torsoM.multiplyMatrices(root, setLocal(0, P.hip, 0, P.lean, 0, 0));
      torso.mesh.setMatrixAt(slot, m.multiplyMatrices(torsoM, setLocal(0, 0, 0, 0, 0, 0, 1, P.breathe, 0.78)));

      headM.multiplyMatrices(torsoM, setLocal(0, 0.5, 0, P.headPitch, P.headYaw, P.headRoll));
      head.mesh.setMatrixAt(slot, headM);
      if (hairPart && hairSlot >= 0) hairPart.mesh.setMatrixAt(hairSlot, headM);

      if (lod === 'far') return; // limbs are hidden meshes at far zoom (simplified figures)

      legs.mesh.setMatrixAt(slot * 2, m.multiplyMatrices(root, setLocal(0.085, P.hip, 0, P.legL, 0, 0)));
      legs.mesh.setMatrixAt(slot * 2 + 1, m.multiplyMatrices(root, setLocal(-0.085, P.hip, 0, P.legR, 0, 0)));

      armLM.multiplyMatrices(torsoM, setLocal(0.215, 0.44, 0, P.armLPitch, 0, P.armLRoll));
      armRM.multiplyMatrices(torsoM, setLocal(-0.215, 0.44, 0, P.armRPitch, 0, P.armRRoll));
      arms.mesh.setMatrixAt(slot * 2, armLM);
      arms.mesh.setMatrixAt(slot * 2 + 1, armRM);
      const showHands = lod === 'near';
      hands.mesh.setMatrixAt(slot * 2, showHands ? armLM : ZERO);
      hands.mesh.setMatrixAt(slot * 2 + 1, showHands ? armRM : ZERO);
      phone.mesh.setMatrixAt(slot, P.phone > 0.5 ? armRM : ZERO);
    },
    commit() {
      for (const p of parts) p.mesh.instanceMatrix.needsUpdate = true;
    },
    setLod(level) {
      lod = level;
      // Far: simple figures (torso, head, status ring). Mid: no hands/phone detail.
      for (const p of [legs, arms]) p.mesh.visible = level !== 'far';
      for (const p of [hands, phone]) p.mesh.visible = level === 'near';
      for (const p of hair.values()) p.mesh.visible = level !== 'far';
    },
    setShadows(cast) {
      for (const p of [legs, torso, head, arms, hands, ...hair.values()]) p.mesh.castShadow = cast;
      blob.mesh.visible = !cast;
    },
    pick(raycaster) {
      const hits = raycaster.intersectObject(proxy.mesh, false);
      const hit = hits[0];
      return hit && hit.instanceId !== undefined ? hit.instanceId : -1;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const mm of materialsOwned) mm.dispose();
      for (const p of parts) p.mesh.dispose();
    },
  };
  return model;
}
