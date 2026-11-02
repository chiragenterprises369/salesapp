import * as THREE from 'three';
import { strFromU8, unzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { FloorLayout } from '../state/layout';
import { customModelBytes } from '../state/layout/published';
import { FloorAmbience } from './kit/ambience';
import type { LabelPalette, Look } from './look';
import { gltfLoader, type OfficeView } from './office';

/**
 * A company's own 3D office (GLB or a zipped glTF made with an AI tool, SPEC 29.5, D-061) drawn as
 * uploaded, placed at (model - origin) x scale from the seat map, and lit in realtime: matte PBR
 * (metalness capped, roughness raised so it reads like the bakes without an environment map),
 * shadows from the engine's key light, the Lead Hub, Evening lamp pools and warm point lights.
 */

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', ktx2: 'image/ktx2', bin: 'application/octet-stream' };

/** Normalises "a/./b/../c.png" -> "a/c.png". */
function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** Parses a zip with one .gltf and its buffers and textures (validated by the API on upload). */
export async function parseGltfZip(data: ArrayBuffer): Promise<GLTF> {
  const files = unzipSync(new Uint8Array(data));
  const names = Object.keys(files).filter((n) => !n.endsWith('/'));
  const main = names.find((n) => n.toLowerCase().endsWith('.gltf'));
  if (!main) throw new Error('The zip contains no .gltf file');
  const base = main.includes('/') ? main.slice(0, main.lastIndexOf('/') + 1) : '';
  const urls = new Map<string, string>();
  for (const n of names) {
    if (n === main) continue;
    const ext = n.split('.').pop()?.toLowerCase() ?? '';
    urls.set(normalize(n), URL.createObjectURL(new Blob([new Uint8Array(files[n]!)], { type: MIME[ext] ?? 'application/octet-stream' })));
  }
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(blob:|data:)/.test(url)) return url;
    let clean = url;
    try {
      clean = decodeURIComponent(url);
    } catch {
      /* keep as is */
    }
    return urls.get(normalize(base + clean)) ?? urls.get(normalize(clean)) ?? url;
  });
  try {
    return await gltfLoader(manager).parseAsync(strFromU8(files[main]!), '');
  } finally {
    for (const u of urls.values()) URL.revokeObjectURL(u);
  }
}

export async function loadModelOffice(layout: FloorLayout): Promise<ModelOffice> {
  const custom = layout.template.custom;
  if (!custom || custom.format === 'layout_json') throw new Error('Not a model floor');
  const data = customModelBytes(custom.key);
  if (!data) throw new Error('The floor model is not downloaded');
  const gltf = custom.format === 'gltf_zip' ? await parseGltfZip(data) : await gltfLoader().parseAsync(data, '');
  return new ModelOffice(gltf, layout);
}

export class ModelOffice implements OfficeView {
  readonly group = new THREE.Group();
  private readonly mats: { mat: THREE.Material & { color: THREE.Color }; base: THREE.Color }[] = [];
  private readonly ambience: FloorAmbience;
  private readonly root: THREE.Object3D;

  constructor(gltf: GLTF, layout: FloorLayout) {
    this.group.name = 'model-office';
    const model = layout.template.custom?.model ?? { scale: 1, origin: [0, 0, 0] as [number, number, number] };
    const s = model.scale;
    this.root = gltf.scene;
    this.root.scale.setScalar(s);
    this.root.position.set(-model.origin[0] * s, -model.origin[1] * s, -model.origin[2] * s);
    const seen = new Set<THREE.Material>();
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      o.receiveShadow = true;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m || seen.has(m)) continue;
        seen.add(m);
        if (m instanceof THREE.MeshStandardMaterial) {
          m.metalness = Math.min(m.metalness, 0.25);
          m.roughness = Math.max(m.roughness, 0.5);
        }
        if ('color' in m && m.color instanceof THREE.Color) this.mats.push({ mat: m as THREE.Material & { color: THREE.Color }, base: m.color.clone() });
      }
    });
    this.group.add(this.root);
    this.ambience = new FloorAmbience(layout, { hub: true });
    this.group.add(this.ambience.group);
  }

  setLook(look: Look) {
    const dim = 1 - 0.16 * look.lightMix;
    for (const { mat, base } of this.mats) mat.color.copy(base).multiply(look.propTint).multiplyScalar(dim);
    this.ambience.setLook(look);
  }

  setGlowEnabled() {}

  setScreen() {}

  drawHub(palette: LabelPalette, waiting: number) {
    this.ambience.drawHub(palette, waiting);
  }

  dispose() {
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
        m.dispose();
      }
    });
    this.ambience.dispose();
  }
}
