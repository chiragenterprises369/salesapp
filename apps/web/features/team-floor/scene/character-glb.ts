import type { AvatarConfig } from '@vistar/shared';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CharacterModel, CharacterPose, LodLevel } from './characters';
import type { Look } from './look';
import { ASSET_BASE, gltfLoader } from './office';

/**
 * Rigged GLB characters (SPEC 12.1 item 3), built by scripts/team-floor/blender/build_characters.py:
 * one shared armature, body meshes (broad|slim x long|short sleeves), hair meshes per
 * AvatarConfig.hairStyle, phone and document props on the hands, and clips (idle, sit, typing,
 * phone_sit, phone_stand, walk, walk_carry, wave, wave_sit, sleep_sit, receive_sit).
 *
 * Per person: a clone of the bone hierarchy, ONE SkinnedMesh whose geometry merges the chosen body
 * and hair (a `slot` attribute picks the tint: skin, hair, top, bottom, shoes, eyes, accent), one
 * AnimationMixer with crossfades, a soft rim light in the shader and an inverted-hull outline
 * (medium/high tier). Clothing varies deterministically by user id (trousers, shoes, sleeves, build).
 */

const SLOTS = ['skin', 'hair', 'top', 'bottom', 'shoes', 'eyes', 'accent'] as const;
type SlotName = (typeof SLOTS)[number];
const SLOT_INDEX = Object.fromEntries(SLOTS.map((s, i) => [s, i])) as Record<SlotName, number>;

const BOTTOMS = ['#2f3a4a', '#1f2937', '#3f3f46', '#4b5563', '#6b5b4a', '#2c3e57', '#3d4a3a', '#57534e'];
const SHOES = ['#1f1f22', '#3b2a20', '#e7e5e4', '#2b2b2b', '#5a3a28'];
const ACCENTS = ['#f1ede6', '#e5e7eb', '#e9e1d4'];

const CROSSFADE_S = 0.28;
const HEAD_STANDING = 1.8;
const HEAD_SEATED = 1.36;

interface Primitive {
  geometry: THREE.BufferGeometry;
  slot: number;
}

export interface CharacterAssets {
  clips: Map<string, THREE.AnimationClip>;
  bodies: Map<string, Primitive[]>;
  hair: Map<string, Primitive[]>;
  rigSource: THREE.Object3D;
  boneNames: string[];
  boneInverses: THREE.Matrix4[];
  bindMatrix: THREE.Matrix4;
}

let assetsPromise: Promise<CharacterAssets> | null = null;

export function loadCharacterAssets(): Promise<CharacterAssets> {
  if (!assetsPromise) {
    assetsPromise = gltfLoader()
      .loadAsync(`${ASSET_BASE}/characters.glb`)
      .then((gltf) => {
        const scene = gltf.scene;
        scene.updateMatrixWorld(true);
        const bodies = new Map<string, Primitive[]>();
        const hair = new Map<string, Primitive[]>();
        let skeleton: THREE.Skeleton | null = null;
        let bindMatrix: THREE.Matrix4 | null = null;
        let reference: THREE.Matrix4 | null = null;
        const owners: THREE.Object3D[] = [];
        scene.traverse((o) => {
          const name = (o.userData.name as string | undefined) ?? '';
          if (!name.startsWith('Body_') && !name.startsWith('Hair_')) return;
          owners.push(o);
          const prims: Primitive[] = [];
          o.traverse((m) => {
            if (!(m instanceof THREE.SkinnedMesh)) return;
            if (!skeleton) {
              skeleton = m.skeleton;
              bindMatrix = m.bindMatrix.clone();
              reference = m.matrixWorld.clone().invert();
            }
            const g = new THREE.BufferGeometry();
            for (const attr of ['position', 'normal', 'skinIndex', 'skinWeight'] as const) {
              const a = m.geometry.getAttribute(attr);
              if (a) g.setAttribute(attr, a.clone());
            }
            if (m.geometry.index) g.setIndex(m.geometry.index.clone());
            if (reference) g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(reference, m.matrixWorld));
            const matName = (m.material as THREE.Material).name as SlotName;
            prims.push({ geometry: g, slot: SLOT_INDEX[matName] ?? SLOT_INDEX.top });
          });
          (name.startsWith('Body_') ? bodies : hair).set(name.slice(5), prims);
        });
        if (!skeleton || !bindMatrix) throw new Error('characters.glb has no skinned meshes');
        const sk = skeleton as THREE.Skeleton;
        const rigSource = scene.clone(true);
        const drop: THREE.Object3D[] = [];
        rigSource.traverse((o) => {
          const name = (o.userData.name as string | undefined) ?? '';
          if (name.startsWith('Body_') || name.startsWith('Hair_')) drop.push(o);
        });
        for (const o of drop) o.removeFromParent();
        const clips = new Map(gltf.animations.map((c) => [c.name, c]));
        return {
          clips,
          bodies,
          hair,
          rigSource,
          boneNames: sk.bones.map((b) => b.name),
          boneInverses: sk.boneInverses.map((m) => m.clone()),
          bindMatrix: bindMatrix as THREE.Matrix4,
        };
      });
    assetsPromise.catch(() => {
      assetsPromise = null;
    });
  }
  return assetsPromise;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

const mergedCache = new Map<string, THREE.BufferGeometry>();

function variantGeometry(assets: CharacterAssets, body: string, hairStyle: string): THREE.BufferGeometry {
  const key = `${body}|${hairStyle}`;
  let g = mergedCache.get(key);
  if (g) return g;
  const parts = [...(assets.bodies.get(body) ?? assets.bodies.values().next().value ?? []), ...(assets.hair.get(hairStyle) ?? [])];
  const geos = parts.map((p) => {
    const geo = p.geometry.clone();
    const n = geo.getAttribute('position').count;
    geo.setAttribute('slot', new THREE.Float32BufferAttribute(new Float32Array(n).fill(p.slot), 1));
    return geo.index ? geo.toNonIndexed() : geo;
  });
  g = mergeGeometries(geos, false) ?? geos[0]!;
  g.computeBoundingSphere();
  mergedCache.set(key, g);
  return g;
}

interface RimUniforms {
  uSlots: { value: THREE.Color[] };
  uRim: { value: THREE.Color };
}

function characterMaterial(colors: THREE.Color[], rim: THREE.Color): { material: THREE.MeshLambertMaterial; uniforms: RimUniforms } {
  const uniforms: RimUniforms = { uSlots: { value: colors }, uRim: { value: rim } };
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSlots = uniforms.uSlots;
    shader.uniforms.uRim = uniforms.uRim;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float slot;\nvarying float vSlot;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSlot = slot;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uSlots[${SLOTS.length}];\nuniform vec3 uRim;\nvarying float vSlot;`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= uSlots[int(vSlot + 0.5)];')
      .replace(
        '#include <opaque_fragment>',
        'float rimF = pow(1.0 - saturate(dot(normal, vec3(0.0, 0.0, 1.0))), 2.6);\noutgoingLight += uRim * rimF;\n#include <opaque_fragment>',
      );
  };
  material.customProgramCacheKey = () => 'vistar-character';
  return { material, uniforms };
}

function outlineMaterial(width: { value: number }, color: THREE.Color) {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWidth = width;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWidth;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\ntransformed += normalize(objectNormal) * uWidth;');
  };
  m.customProgramCacheKey = () => 'vistar-outline';
  return m;
}

interface Person {
  rig: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  outline: THREE.SkinnedMesh;
  material: THREE.MeshLambertMaterial;
  uniforms: RimUniforms;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: string;
  phase: number;
  phone: THREE.Object3D | null;
  doc: THREE.Object3D | null;
  scale: number;
  visible: boolean;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export function createGlbCharacters(assets: CharacterAssets, capacity: number, look: Look): CharacterModel {
  const cap = Math.max(1, capacity);
  const group = new THREE.Group();
  group.name = 'characters';
  const people: (Person | null)[] = new Array(cap).fill(null);
  const owned: { dispose(): void }[] = [];
  const outlineWidth = { value: 0.012 };
  const outlineMat = outlineMaterial(outlineWidth, look.outline.clone());
  owned.push(outlineMat);
  let outlinesOn = true;
  let shadows = false;
  let lod: LodLevel = 'near';
  let reducedMotion = false;
  const rimColor = look.rim.clone().multiplyScalar(look.rimStrength);

  // Shared instanced extras: blob shadows, on-call rings, pick proxies.
  const blobGeo = new THREE.CircleGeometry(0.36, 24);
  blobGeo.rotateX(-Math.PI / 2);
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false });
  const blob = new THREE.InstancedMesh(blobGeo, blobMat, cap);
  const ringGeo = new THREE.RingGeometry(0.46, 0.54, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
  const ring = new THREE.InstancedMesh(ringGeo, ringMat, cap);
  const proxyGeo = new THREE.CylinderGeometry(0.34, 0.34, 1.8, 8);
  proxyGeo.translate(0, 0.9, 0);
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const proxy = new THREE.InstancedMesh(proxyGeo, proxyMat, cap);
  proxy.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  for (const m of [blob, ring, proxy]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    for (let i = 0; i < cap; i++) m.setMatrixAt(i, ZERO);
    group.add(m);
  }
  blob.renderOrder = 1;
  ring.renderOrder = 3;
  owned.push(blobGeo, blobMat, ringGeo, ringMat, proxyGeo, proxyMat, blob, ring, proxy);
  const ringOn = new Uint8Array(cap);
  const tmp = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  const spawn = (slot: number, avatar: AvatarConfig | null, userId: string): Person => {
    const a = avatar ?? { skinTone: '#c68642', hairColor: '#1f1a17', hairStyle: 'short', outfitColor: '#64748b' };
    const h = hash(userId);
    const slim = a.hairStyle === 'long' || a.hairStyle === 'bun' ? h < 0.85 : h < 0.15;
    const sleeves = hash(userId + ':sleeve') < 0.45 ? 'short' : 'long';
    const body = `${slim ? 'slim' : 'broad'}_${sleeves}`;
    const geo = variantGeometry(assets, body, a.hairStyle);
    const colors = [
      new THREE.Color(a.skinTone),
      new THREE.Color(a.hairColor),
      new THREE.Color(a.outfitColor),
      new THREE.Color(BOTTOMS[Math.floor(hash(userId + ':b') * BOTTOMS.length)]!),
      new THREE.Color(SHOES[Math.floor(hash(userId + ':s') * SHOES.length)]!),
      new THREE.Color('#1b1716'),
      new THREE.Color(ACCENTS[Math.floor(hash(userId + ':a') * ACCENTS.length)]!),
    ];
    const { material, uniforms } = characterMaterial(colors, rimColor);
    owned.push(material);
    const rig = assets.rigSource.clone(true);
    rig.updateMatrixWorld(true);
    const bones = assets.boneNames.map((n) => rig.getObjectByName(n) as THREE.Bone);
    const skeleton = new THREE.Skeleton(bones, assets.boneInverses);
    const mesh = new THREE.SkinnedMesh(geo, material);
    mesh.bind(skeleton, assets.bindMatrix);
    mesh.frustumCulled = false;
    mesh.castShadow = shadows;
    const outline = new THREE.SkinnedMesh(geo, outlineMat);
    outline.bind(skeleton, assets.bindMatrix);
    outline.frustumCulled = false;
    outline.visible = outlinesOn && lod !== 'far';
    rig.add(mesh, outline);
    let phone: THREE.Object3D | null = null;
    let doc: THREE.Object3D | null = null;
    rig.traverse((o) => {
      const n = (o.userData.name as string | undefined) ?? '';
      if (n === 'Prop_Phone') phone = o;
      if (n === 'Prop_Document') doc = o;
    });
    for (const p of [phone, doc] as (THREE.Object3D | null)[]) if (p) p.visible = false;
    const scale = 0.95 + hash(userId + ':h') * 0.08;
    rig.scale.setScalar(scale);
    rig.visible = false;
    const mixer = new THREE.AnimationMixer(rig);
    group.add(rig);
    return { rig, mesh, outline, material, uniforms, mixer, actions: new Map(), current: '', phase: h, phone, doc, scale, visible: false };
  };

  const clipFor = (pose: CharacterPose): string => {
    const s = pose.seated;
    switch (pose.clip) {
      case 'walking':
        return pose.prop === 'document' ? 'walk_carry' : 'walk';
      case 'carry':
        return 'walk_carry';
      case 'typing':
        return s ? 'typing' : 'idle';
      case 'phone':
        return s ? 'phone_sit' : 'phone_stand';
      case 'sleeping':
        return s ? 'sleep_sit' : 'idle';
      case 'wave':
        return s ? 'wave_sit' : 'wave';
      case 'receive':
        return s ? 'receive_sit' : 'idle';
      case 'sit':
        return s ? 'sit' : 'idle';
      case 'idle':
      default:
        return s ? 'sit' : 'idle';
    }
  };

  const play = (p: Person, name: string, instant: boolean) => {
    const clip = assets.clips.get(name) ?? assets.clips.get('idle');
    if (!clip) return;
    let action = p.actions.get(name);
    if (!action) {
      action = p.mixer.clipAction(clip);
      p.actions.set(name, action);
    }
    const prev = p.current ? p.actions.get(p.current) : undefined;
    action.reset();
    action.time = (p.phase * clip.duration * 7.3) % clip.duration;
    action.setEffectiveWeight(1);
    action.play();
    if (prev && prev !== action && !instant) {
      action.crossFadeFrom(prev, CROSSFADE_S, false);
    } else if (prev && prev !== action) {
      prev.stop();
    }
    p.current = name;
  };

  const model: CharacterModel = {
    kind: 'glb',
    object: group,
    capacity: cap,
    headTop(seated) {
      return seated ? HEAD_SEATED : HEAD_STANDING;
    },
    setAppearance(slot, avatar, userId) {
      if (people[slot]) return;
      people[slot] = spawn(slot, avatar, userId);
    },
    setStatusColor(slot, color, show) {
      ring.setColorAt(slot, color);
      if (ring.instanceColor) ring.instanceColor.needsUpdate = true;
      ringOn[slot] = show ? 1 : 0;
    },
    update(slot, pose, dt) {
      const p = people[slot];
      if (!p) return;
      if (!pose.visible) {
        if (p.visible) {
          p.rig.visible = false;
          p.visible = false;
        }
        blob.setMatrixAt(slot, ZERO);
        ring.setMatrixAt(slot, ZERO);
        proxy.setMatrixAt(slot, ZERO);
        return;
      }
      if (!p.visible) {
        p.rig.visible = true;
        p.visible = true;
      }
      p.rig.position.set(pose.x, 0, pose.z);
      p.rig.rotation.y = pose.heading;
      const name = clipFor(pose);
      const changed = name !== p.current;
      if (changed) play(p, name, reducedMotion || !p.current);
      if (p.phone) p.phone.visible = pose.prop === 'phone' && lod === 'near';
      if (p.doc) p.doc.visible = pose.prop === 'document' && lod === 'near';
      if (!reducedMotion && lod !== 'far') p.mixer.update(dt);
      else if (changed) p.mixer.update(reducedMotion ? 0.0001 : CROSSFADE_S + 0.01);
      q.setFromAxisAngle(up, pose.heading);
      tmp.compose(pos.set(pose.x, 0, pose.z), q, one);
      proxy.setMatrixAt(slot, tmp);
      blob.setMatrixAt(slot, shadows ? ZERO : tmp);
      ring.setMatrixAt(slot, ringOn[slot] ? tmp : ZERO);
    },
    commit() {
      blob.instanceMatrix.needsUpdate = true;
      ring.instanceMatrix.needsUpdate = true;
      proxy.instanceMatrix.needsUpdate = true;
    },
    setLod(level) {
      lod = level;
      for (const p of people) if (p) p.outline.visible = outlinesOn && level !== 'far';
    },
    setShadows(cast) {
      shadows = cast;
      for (const p of people) if (p) p.mesh.castShadow = cast;
    },
    setOutline(on, zoom) {
      outlinesOn = on;
      // Constant ~1.1 px outline: world width = px / (px per metre).
      outlineWidth.value = 1.1 / Math.max(8, zoom);
      for (const p of people) if (p) p.outline.visible = on && lod !== 'far';
    },
    setReducedMotion(on) {
      reducedMotion = on;
    },
    setLook(l) {
      rimColor.copy(l.rim).multiplyScalar(l.rimStrength);
      outlineMat.color.copy(l.outline);
      blobMat.opacity = 0.14 + l.shadowOpacity * 0.3;
    },
    pick(raycaster) {
      const hits = raycaster.intersectObject(proxy, false);
      const hit = hits[0];
      return hit && hit.instanceId !== undefined ? hit.instanceId : -1;
    },
    dispose() {
      for (const o of owned) o.dispose();
      for (const p of people) p?.mixer.stopAllAction();
    },
  };
  return model;
}
