import * as THREE from 'three';
import { EMISSIVE, SURFACES, type Look, type Surface } from './look';

/** One shared matte material per surface; theme tweens write into these in place. */
export type MaterialSet = Record<Surface, THREE.MeshStandardMaterial | THREE.MeshBasicMaterial>;

const BASIC: readonly Surface[] = ['blob', 'select', 'label'];
const TRANSPARENT: readonly Surface[] = ['glass', 'blob'];
const FACETED: readonly Surface[] = ['plant'];

export function createMaterials(look: Look): MaterialSet {
  const set = {} as MaterialSet;
  for (const s of SURFACES) {
    if (BASIC.includes(s)) {
      set[s] = new THREE.MeshBasicMaterial({
        color: look.color[s].clone(),
        transparent: TRANSPARENT.includes(s),
        opacity: s === 'blob' ? 0.16 : 1,
        depthWrite: !TRANSPARENT.includes(s),
      });
      continue;
    }
    const m = new THREE.MeshStandardMaterial({
      color: look.color[s].clone(),
      roughness: s === 'glass' ? 0.6 : 0.92,
      metalness: 0,
      flatShading: FACETED.includes(s),
      transparent: TRANSPARENT.includes(s),
      opacity: s === 'glass' ? look.glassOpacity : 1,
      depthWrite: !TRANSPARENT.includes(s),
    });
    if (EMISSIVE.includes(s)) {
      m.emissive.copy(look.emissive[s]);
      m.emissiveIntensity = look.emissiveIntensity[s];
    }
    set[s] = m;
  }
  return set;
}

export function applyLook(set: MaterialSet, look: Look, dark: number) {
  for (const s of SURFACES) {
    const m = set[s];
    m.color.copy(look.color[s]);
    if (m instanceof THREE.MeshStandardMaterial && EMISSIVE.includes(s)) {
      m.emissive.copy(look.emissive[s]);
      m.emissiveIntensity = look.emissiveIntensity[s];
    }
  }
  set.glass.opacity = look.glassOpacity;
  set.blob.opacity = 0.16 + 0.22 * dark;
}

export function disposeMaterials(set: MaterialSet) {
  for (const s of SURFACES) set[s].dispose();
}
