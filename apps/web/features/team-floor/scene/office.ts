import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { FloorLayout } from '../state/layout';
import type { TemplateId } from '../state/template';
import type { LabelPalette, Look } from './look';
import { GlowLayer } from './glow';

/**
 * The authored office (SPEC 12.1 items 1-2): a Draco GLB built by scripts/team-floor/blender,
 * the Day lightmap and an AO map baked in Cycles. Contract with the Blender build:
 * - `office_static`: lightmapped architecture and furniture (UV0 textures, UV1 lightmap/AO),
 * - `office_glass`: glass and window panes, `office_emissive`: hub ring, reception edge, lamps,
 * - `screen:<seatId>`: one monitor screen per seat, `hub_screen`: the Lead Hub display,
 * - `inst:<key>:<n>`: repeated props sharing one mesh (chairs, monitors, plants) -> InstancedMesh.
 * Static surfaces render unlit (MeshBasicMaterial x lightmap x AO), which is both the closest
 * match to the bake and the cheapest shading; instanced props and characters use realtime light.
 */

export const ASSET_BASE = '/team-floor';

let draco: DRACOLoader | null = null;

export function gltfLoader() {
  const loader = new GLTFLoader();
  if (!draco) {
    draco = new DRACOLoader();
    draco.setDecoderPath(`${ASSET_BASE}/draco/`);
  }
  loader.setDRACOLoader(draco);
  return loader;
}

export interface BakeMeta {
  lightmapScale: number;
  maps?: Record<string, { file: string; scale?: number }>;
}

export interface OfficeAssets {
  gltf: GLTF;
  day: THREE.Texture;
  /** Evening lightmap (null when the template has no Evening bake: the dark look dims the Day map). */
  evening: THREE.Texture | null;
  ao: THREE.Texture;
  meta: BakeMeta;
}

const officeCache = new Map<TemplateId, Promise<OfficeAssets>>();

function loadTexture(url: string, srgb: boolean): Promise<THREE.Texture> {
  return new THREE.TextureLoader().loadAsync(url).then((t) => {
    t.flipY = false;
    t.channel = 1;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  });
}

/** Loads (once per template) the office GLB, its bake metadata, the Day and Evening lightmaps and AO. */
export function loadOfficeAssets(id: TemplateId): Promise<OfficeAssets> {
  let p = officeCache.get(id);
  if (!p) {
    const base = `${ASSET_BASE}/office-${id}`;
    const meta = fetch(`${base}.bake.json`).then((r) => {
      if (!r.ok) throw new Error(`Bake metadata missing (${r.status})`);
      return r.json() as Promise<BakeMeta>;
    });
    // Both lit maps load up front so the theme cross-fade never waits for the network.
    const evening = meta.then((m) => (m.maps?.evening ? loadTexture(`${base}-evening.webp`, true).catch(() => null) : null));
    p = Promise.all([gltfLoader().loadAsync(`${base}.glb`), meta, loadTexture(`${base}-day.webp`, true), evening, loadTexture(`${base}-ao.webp`, false)]).then(
      ([gltf, metaJson, day, eveningTex, ao]) => ({ gltf, meta: metaJson, day, evening: eveningTex, ao }),
    );
    p.catch(() => officeCache.delete(id));
    officeCache.set(id, p);
  }
  return p;
}

/**
 * Two baked lightmaps on one material: the Day map in three's own `lightMap` slot and the Evening map
 * blended in by `lightMix` (shared uniforms, so one write updates every office material).
 */
interface LightmapBlend {
  lightMap2: { value: THREE.Texture | null };
  lightMapIntensity2: { value: number };
  lightMix: { value: number };
}

const LIGHTMAP_SAMPLE = /vec4 lightMapTexel = texture2D\( lightMap, vLightMapUv \);\s*reflectedLight\.indirectDiffuse \+= lightMapTexel\.rgb \* lightMapIntensity \* RECIPROCAL_PI;/;

function blendLightmaps(mat: THREE.MeshBasicMaterial, u: LightmapBlend) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.lightMap2 = u.lightMap2;
    shader.uniforms.lightMapIntensity2 = u.lightMapIntensity2;
    shader.uniforms.lightMix = u.lightMix;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lightmap_pars_fragment>', '#include <lightmap_pars_fragment>\nuniform sampler2D lightMap2;\nuniform float lightMapIntensity2;\nuniform float lightMix;')
      .replace(
        LIGHTMAP_SAMPLE,
        'vec3 lmDay = texture2D( lightMap, vLightMapUv ).rgb * lightMapIntensity;\n\t\tvec3 lmEve = texture2D( lightMap2, vLightMapUv ).rgb * lightMapIntensity2;\n\t\treflectedLight.indirectDiffuse += mix( lmDay, lmEve, lightMix ) * RECIPROCAL_PI;',
      );
  };
  mat.customProgramCacheKey = () => 'vistar-lightmap-blend';
}

const EMISSIVE_KIND: Record<string, 'hub' | 'hubSoft' | 'reception' | 'lamp'> = {
  emissive_hub: 'hub',
  emissive_hub_soft: 'hubSoft',
  emissive_reception: 'reception',
  emissive_lamp: 'lamp',
};

interface Lit {
  mat: THREE.MeshBasicMaterial;
  base: THREE.Color;
}

export class Office {
  readonly group = new THREE.Group();
  private readonly meta: BakeMeta;
  private readonly lit: Lit[] = [];
  private readonly blend: LightmapBlend;
  private readonly hasEvening: boolean;
  private readonly glow: GlowLayer;
  private readonly glass: { mat: THREE.MeshBasicMaterial; kind: 'glass' | 'hub' | 'window' }[] = [];
  private readonly emissive: { mat: THREE.MeshBasicMaterial; kind: 'hub' | 'hubSoft' | 'reception' | 'lamp' }[] = [];
  private readonly screens = new Map<string, { mat: THREE.MeshBasicMaterial; on: number }>();
  private readonly props: THREE.MeshLambertMaterial[] = [];
  private readonly owned: { dispose(): void }[] = [];
  private readonly shadowMat: THREE.ShadowMaterial;
  private readonly contact: THREE.MeshBasicMaterial;
  private readonly pools: THREE.MeshBasicMaterial;
  private readonly poolMesh: THREE.InstancedMesh | null;
  private readonly hubCanvas: HTMLCanvasElement;
  private readonly hubTexture: THREE.CanvasTexture;
  private readonly screenTexture: THREE.CanvasTexture;
  private screenColor = new THREE.Color('#cfe0ff');
  private screenLevel = 1;
  readonly instancedProps: THREE.InstancedMesh[] = [];

  constructor(assets: OfficeAssets, layout: FloorLayout) {
    this.meta = assets.meta;
    this.hasEvening = !!assets.evening;
    this.blend = { lightMap2: { value: assets.evening ?? assets.day }, lightMapIntensity2: { value: 1 }, lightMix: { value: 0 } };
    const root = assets.gltf.scene.clone(true);
    root.updateMatrixWorld(true);
    const screenNodes = new Map<string, THREE.Mesh>();

    this.screenTexture = screenTexture();
    this.owned.push(this.screenTexture);
    this.hubCanvas = document.createElement('canvas');
    this.hubCanvas.width = 512;
    this.hubCanvas.height = 256;
    this.hubTexture = new THREE.CanvasTexture(this.hubCanvas);
    this.hubTexture.colorSpace = THREE.SRGBColorSpace;
    this.hubTexture.flipY = false; // glTF UV convention
    this.hubTexture.anisotropy = 4;
    this.owned.push(this.hubTexture);

    const instanceGroups = new Map<string, THREE.Object3D[]>();
    const remove: THREE.Object3D[] = [];
    root.traverse((o) => {
      const name = (o.userData.name as string | undefined) ?? '';
      if (name.startsWith('inst:')) {
        const key = name.split(':')[1] ?? name;
        const list = instanceGroups.get(key);
        if (list) list.push(o);
        else instanceGroups.set(key, [o]);
        remove.push(o);
        return;
      }
      if (name.startsWith('screen:')) {
        const id = name.slice('screen:'.length);
        o.traverse((m) => {
          if (!(m instanceof THREE.Mesh)) return;
          const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', map: this.screenTexture });
          this.owned.push(mat);
          m.material = mat;
          this.screens.set(id, { mat, on: 1 });
          screenNodes.set(id, m);
        });
        return;
      }
      if (name === 'hub_screen') {
        o.traverse((m) => {
          if (!(m instanceof THREE.Mesh)) return;
          const mat = new THREE.MeshBasicMaterial({ map: this.hubTexture, toneMapped: false });
          this.owned.push(mat);
          m.material = mat;
        });
      }
    });

    // Static, glass and emissive meshes (by material name).
    root.traverse((m) => {
      if (!(m instanceof THREE.Mesh) || remove.some((r) => isDescendant(m, r))) return;
      const src = m.material as THREE.MeshStandardMaterial;
      const name = src.name ?? '';
      if (m.material instanceof THREE.MeshBasicMaterial) return; // screens, hub screen
      if (name === 'glass' || name === 'glass_hub' || name === 'window_glass') {
        const mat = new THREE.MeshBasicMaterial({ color: src.color.clone(), transparent: true, opacity: 0.2, depthWrite: false });
        this.owned.push(mat);
        this.glass.push({ mat, kind: name === 'glass' ? 'glass' : name === 'glass_hub' ? 'hub' : 'window' });
        m.material = mat;
        m.renderOrder = 2;
        return;
      }
      const kind = EMISSIVE_KIND[name];
      if (kind) {
        const mat = new THREE.MeshBasicMaterial({ color: src.emissive.clone() });
        this.owned.push(mat);
        this.emissive.push({ mat, kind });
        m.material = mat;
        return;
      }
      const lightmapped = !!m.geometry.getAttribute('uv1');
      const mat = new THREE.MeshBasicMaterial({
        color: src.color.clone(),
        map: src.map,
        transparent: src.transparent,
        opacity: src.opacity,
        lightMap: lightmapped ? assets.day : null,
        aoMap: lightmapped ? assets.ao : null,
        aoMapIntensity: 1,
      });
      mat.name = name;
      if (lightmapped) blendLightmaps(mat, this.blend);
      this.owned.push(mat);
      this.lit.push({ mat, base: src.color.clone() });
      m.material = mat;
    });

    // Repeated props -> InstancedMesh per primitive, lit in realtime like the characters.
    for (const [key, nodes] of instanceGroups) {
      const first = nodes[0];
      if (!first) continue;
      const parts: THREE.Mesh[] = [];
      first.traverse((m) => {
        if (m instanceof THREE.Mesh) parts.push(m);
      });
      parts.forEach((part, pi) => {
        const src = part.material as THREE.MeshStandardMaterial;
        const mat = new THREE.MeshLambertMaterial({ color: src.color.clone(), map: src.map ?? null, transparent: src.transparent, opacity: src.opacity });
        this.owned.push(mat);
        this.props.push(mat);
        const inst = new THREE.InstancedMesh(part.geometry, mat, nodes.length);
        inst.name = `props:${key}:${pi}`;
        const local = new THREE.Matrix4();
        nodes.forEach((n, i) => {
          // World matrix of this node's matching part.
          let target: THREE.Mesh | null = null;
          let k = 0;
          n.traverse((m) => {
            if (m instanceof THREE.Mesh) {
              if (k === pi) target = m;
              k++;
            }
          });
          const t = target as THREE.Mesh | null;
          local.copy(t ? t.matrixWorld : n.matrixWorld);
          inst.setMatrixAt(i, local);
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        this.instancedProps.push(inst);
        this.group.add(inst);
      });
    }
    for (const r of remove) r.removeFromParent();
    this.group.add(root);
    this.glow = new GlowLayer(layout.template, screenNodes);
    this.owned.push(this.glow);
    this.group.add(this.glow.group);

    // Shadow catcher over the floor (character shadows from the realtime key light).
    const shape = new THREE.Shape(layout.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
    const floorGeo = new THREE.ShapeGeometry(shape);
    floorGeo.rotateX(-Math.PI / 2);
    this.owned.push(floorGeo);
    this.shadowMat = new THREE.ShadowMaterial({ opacity: 0.24, depthWrite: false });
    this.owned.push(this.shadowMat);
    const catcher = new THREE.Mesh(floorGeo, this.shadowMat);
    catcher.position.y = 0.004;
    catcher.receiveShadow = true;
    catcher.renderOrder = 1;
    catcher.name = 'shadow-catcher';
    this.group.add(catcher);

    // Soft contact shadow under the diorama.
    const shadowTex = radialTexture(true);
    this.owned.push(shadowTex);
    this.contact = new THREE.MeshBasicMaterial({ map: shadowTex, color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false });
    this.owned.push(this.contact);
    const span = Math.max(layout.width, layout.depth);
    const contactGeo = new THREE.PlaneGeometry(layout.width + span * 0.5, layout.depth + span * 0.5);
    contactGeo.rotateX(-Math.PI / 2);
    this.owned.push(contactGeo);
    const contact = new THREE.Mesh(contactGeo, this.contact);
    contact.position.set(layout.minX + layout.width / 2 + 0.8, -0.34, layout.minZ + layout.depth / 2 + 0.8);
    contact.renderOrder = -1;
    this.group.add(contact);

    // Warm light pools for the dark interim look (additive, hidden in the Day look).
    const poolTex = radialTexture(false);
    this.owned.push(poolTex);
    this.pools = new THREE.MeshBasicMaterial({ map: poolTex, color: 0xffb86b, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    this.owned.push(this.pools);
    const poolGeo = new THREE.PlaneGeometry(1, 1);
    poolGeo.rotateX(-Math.PI / 2);
    this.owned.push(poolGeo);
    this.poolMesh = layout.lights.length ? new THREE.InstancedMesh(poolGeo, this.pools, layout.lights.length) : null;
    if (this.poolMesh) {
      const m = new THREE.Matrix4();
      layout.lights.forEach((l, i) => {
        const s = 2.2 + l.y * 0.9;
        m.makeScale(s, 1, s).setPosition(l.x, 0.012, l.z);
        this.poolMesh!.setMatrixAt(i, m);
      });
      this.poolMesh.renderOrder = 1;
      this.poolMesh.visible = false;
      this.group.add(this.poolMesh);
    }
  }

  setLook(look: Look) {
    const dayScale = this.meta.maps?.day?.scale ?? this.meta.lightmapScale;
    const eveScale = this.meta.maps?.evening?.scale ?? this.meta.lightmapScale;
    // Without an Evening bake the dark look falls back to the dimmed, cooled Day map (interim look).
    const mix = this.hasEvening ? look.lightMix : 0;
    const tint = this.hasEvening ? look.tint : look.interimTint;
    const dayLevel = look.lightmap;
    this.blend.lightMix.value = mix;
    this.blend.lightMapIntensity2.value = eveScale * Math.PI * look.eveningLightmap;
    for (const { mat, base } of this.lit) {
      mat.color.copy(base).multiply(tint);
      if (mat.lightMap) mat.lightMapIntensity = dayScale * Math.PI * dayLevel;
      mat.aoMapIntensity = look.ao;
    }
    for (const g of this.glass) {
      if (g.kind === 'window') {
        g.mat.color.copy(look.windowColor);
        g.mat.opacity = 0.92;
      } else {
        g.mat.opacity = g.kind === 'hub' ? look.glassOpacity + 0.2 : look.glassOpacity;
      }
    }
    for (const e of this.emissive) {
      const [color, level] =
        e.kind === 'hub' ? [look.hub, look.hubLevel] : e.kind === 'hubSoft' ? [look.hub, look.hubLevel * 0.8] : e.kind === 'reception' ? [look.reception, look.receptionLevel] : [look.lamp, look.lampLevel];
      e.mat.color.copy(color).multiplyScalar(level);
      if (e.kind === 'hubSoft') e.mat.color.lerp(new THREE.Color(1, 1, 1), 0.35);
    }
    this.screenColor.copy(look.screen);
    this.screenLevel = look.screenLevel;
    for (const s of this.screens.values()) this.paintScreen(s);
    for (const p of this.props) p.color.copy(p.userData.base ?? (p.userData.base = p.color.clone())).multiply(look.propTint);
    this.shadowMat.opacity = look.shadowOpacity;
    this.contact.opacity = look.contactShadow;
    if (this.poolMesh) {
      const level = this.hasEvening ? 0 : look.poolLevel;
      this.poolMesh.visible = level > 0.01;
      this.pools.color.copy(look.pool).multiplyScalar(level);
    }
    this.glow.setLevel(look.glowLevel);
  }

  /** Quality tier gate for the glow cards (off on the low tier). */
  setGlowEnabled(on: boolean) {
    this.glow.setEnabled(on);
  }

  /** Screen brightness per seat: 1 = working, 0.35 = idle, 0 = off (empty or offline). */
  setScreen(seatId: string, level: number) {
    const s = this.screens.get(seatId);
    if (!s || s.on === level) return;
    s.on = level;
    this.paintScreen(s);
    this.glow.setScreen(seatId, level);
  }

  private paintScreen(s: { mat: THREE.MeshBasicMaterial; on: number }) {
    const off = new THREE.Color('#161b23');
    s.mat.color.copy(off).lerp(this.screenColor.clone().multiplyScalar(this.screenLevel), s.on);
  }

  drawHub(palette: LabelPalette, waiting: number) {
    const ctx = this.hubCanvas.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = this.hubCanvas;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1d3f8f');
    g.addColorStop(1, '#0f1f4a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(147, 197, 253, 0.65)';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = '#e8f0ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 92px ${palette.font}`;
    if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '6px';
    ctx.fillText('LEAD HUB', w / 2, h / 2 - (waiting > 0 ? 22 : 0));
    if (waiting > 0) {
      ctx.font = `600 44px ${palette.font}`;
      ctx.fillStyle = '#93c5fd';
      ctx.fillText(`${waiting} waiting`, w / 2, h / 2 + 62);
    }
    this.hubTexture.needsUpdate = true;
  }

  dispose() {
    for (const o of this.owned) o.dispose();
    for (const i of this.instancedProps) i.dispose();
  }
}

/** Shared monitor content: a light CRM dashboard (header, sidebar, KPI tiles, chart, rows). */
function screenTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 150;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#f4f8ff');
  g.addColorStop(1, '#dce8ff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#4f46e5';
  ctx.fillRect(0, 0, w, 16);
  ctx.fillStyle = '#c9d8f5';
  ctx.fillRect(0, 16, 40, h - 16);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i === 1 ? '#8aa6e8' : '#aec3ec';
    ctx.fillRect(7, 26 + i * 16, 26, 6);
  }
  const tiles = ['#3b82f6', '#10b981', '#f59e0b'];
  tiles.forEach((c, i) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(50 + i * 68, 24, 60, 30);
    ctx.fillStyle = c;
    ctx.fillRect(56 + i * 68, 30, 24, 6);
    ctx.fillStyle = '#9fb0cc';
    ctx.fillRect(56 + i * 68, 42, 40, 5);
  });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(50, 62, 128, 78);
  const bars = [30, 46, 38, 58, 50, 66, 44];
  bars.forEach((b, i) => {
    ctx.fillStyle = i === 5 ? '#4f46e5' : '#93b4f5';
    ctx.fillRect(58 + i * 16, 132 - b, 10, b);
  });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(186, 62, 62, 78);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = '#b8c6de';
    ctx.fillRect(192, 70 + i * 11, 48 - (i % 3) * 8, 5);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 4;
  return tex;
}

function isDescendant(o: THREE.Object3D, ancestor: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

/** Soft radial gradient: dark contact shadow (rounded rectangle) or a warm light pool (circle). */
function radialTexture(rect: boolean): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  if (rect) {
    ctx.filter = 'blur(22px)';
    ctx.fillStyle = '#fff';
    ctx.fillRect(size * 0.2, size * 0.2, size * 0.6, size * 0.6);
  } else {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  if (rect) {
    // Use the canvas as alpha: white = shadow.
    tex.format = THREE.RGBAFormat;
  }
  return tex;
}
