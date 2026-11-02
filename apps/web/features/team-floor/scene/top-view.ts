import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { parseGltfZip } from './model-office';
import { gltfLoader } from './office';

/**
 * Top-down picture of an uploaded office model for the Super Admin seat tool (lazily imported, so
 * three.js stays out of the page's first chunk). The image covers the model's footprint after the
 * seat map placement ((model - origin) x scale); x runs right and z down, like the seat map.
 */

export interface TopView {
  /** PNG data URL. */
  url: string;
  /** Image extent in scene metres. */
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** Model bounding box in model units (no placement): the default origin is its min corner. */
  raw: { min: [number, number, number]; max: [number, number, number] };
}

const parsed = new Map<ArrayBuffer, Promise<GLTF>>();

function parse(data: ArrayBuffer, format: 'glb' | 'gltf_zip'): Promise<GLTF> {
  let p = parsed.get(data);
  if (!p) {
    p = format === 'gltf_zip' ? parseGltfZip(data) : gltfLoader().parseAsync(data, '');
    parsed.set(data, p);
  }
  return p;
}

export async function renderTopView(
  data: ArrayBuffer,
  format: 'glb' | 'gltf_zip',
  placement: { scale: number; origin: [number, number, number] },
  maxPx = 1400,
): Promise<TopView> {
  const gltf = await parse(data, format);
  const model = gltf.scene;
  model.position.set(0, 0, 0);
  model.scale.setScalar(1);
  model.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(model);
  const s = placement.scale;
  model.scale.setScalar(s);
  model.position.set(-placement.origin[0] * s, -placement.origin[1] * s, -placement.origin[2] * s);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const margin = Math.max(0.5, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.03);
  const minX = box.min.x - margin;
  const maxX = box.max.x + margin;
  const minZ = box.min.z - margin;
  const maxZ = box.max.z + margin;
  const w = Math.max(0.5, maxX - minX);
  const d = Math.max(0.5, maxZ - minZ);
  const px = w >= d ? maxPx : Math.round((maxPx * w) / d);
  const py = w >= d ? Math.round((maxPx * d) / w) : maxPx;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f4f5f7');
  scene.add(new THREE.HemisphereLight('#ffffff', '#c9c4bd', 2.4));
  const sun = new THREE.DirectionalLight('#ffffff', 1.6);
  sun.position.set(-4, 10, -3);
  scene.add(sun);
  const holder = new THREE.Group();
  holder.add(model);
  scene.add(holder);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const camera = new THREE.OrthographicCamera(
    -w / 2,
    w / 2,
    d / 2,
    -d / 2,
    0.1,
    Math.max(100, box.max.y - box.min.y + 50),
  );
  camera.up.set(0, 0, -1);
  camera.position.set(cx, box.max.y + 20, cz);
  camera.lookAt(cx, box.min.y, cz);

  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = py;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(px, py, false);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.render(scene, camera);
    const url = canvas.toDataURL('image/png');
    return {
      url,
      bounds: { minX, minZ, maxX, maxZ },
      raw: {
        min: [rawBox.min.x, rawBox.min.y, rawBox.min.z],
        max: [rawBox.max.x, rawBox.max.y, rawBox.max.z],
      },
    };
  } finally {
    holder.remove(model);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
