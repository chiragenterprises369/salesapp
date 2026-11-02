import * as THREE from 'three';
import { ART } from '../look';

/**
 * Procedural floor finishes for the module kit (no image downloads): oak and walnut planks, carpet,
 * stone tiles. Painted once per finish on a canvas; UVs are world metres, so `repeat` = 1 / tile size.
 * Colours mirror the authored office palette (look.ts ART) so custom floors sit next to the templates.
 */

export type FloorFinish = 'oak' | 'walnut' | 'carpet' | 'stone';

const TILE_M: Record<FloorFinish, number> = { oak: 2.4, walnut: 2.4, carpet: 1.2, stone: 1.2 };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shade(hex: string, f: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}

function paint(finish: FloorFinish, ctx: CanvasRenderingContext2D, size: number) {
  const r = rng(finish.length * 977);
  if (finish === 'oak' || finish === 'walnut') {
    const base = finish === 'oak' ? '#c99a6b' : ART.walnut;
    const plankW = size / 13;
    for (let col = 0; col < 13; col++) {
      let y = -r() * size;
      while (y < size) {
        const len = size * (0.35 + r() * 0.45);
        ctx.fillStyle = shade(base, 0.9 + r() * 0.18);
        ctx.fillRect(col * plankW, y, plankW, len);
        // grain
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = '#000000';
        for (let g = 0; g < 3; g++) ctx.fillRect(col * plankW + r() * plankW, y, 1, len);
        ctx.globalAlpha = 1;
        ctx.fillStyle = shade(base, 0.72);
        ctx.fillRect(col * plankW, y + len - 1, plankW, 1.5);
        y += len;
      }
      ctx.fillStyle = shade(base, 0.7);
      ctx.fillRect(col * plankW, 0, 1, size);
    }
    return;
  }
  if (finish === 'carpet') {
    ctx.fillStyle = ART.carpet;
    ctx.fillRect(0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (r() - 0.5) * 22;
      img.data[i] = Math.max(0, Math.min(255, img.data[i]! + n));
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + n));
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + n));
    }
    ctx.putImageData(img, 0, 0);
    return;
  }
  // stone tiles 0.6 m (two per texture side)
  const tile = size / 2;
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      ctx.fillStyle = shade('#cfccc6', 0.94 + r() * 0.08);
      ctx.fillRect(x * tile, y * tile, tile, tile);
    }
  }
  ctx.fillStyle = '#a9a59e';
  for (let i = 0; i <= 2; i++) {
    ctx.fillRect(i * tile - 1, 0, 2, size);
    ctx.fillRect(0, i * tile - 1, size, 2);
  }
}

const cache = new Map<FloorFinish, THREE.CanvasTexture>();

/** Shared texture per finish (kept for the page lifetime; a few hundred KB in total). */
export function floorTexture(finish: FloorFinish): THREE.CanvasTexture {
  let tex = cache.get(finish);
  if (tex) return tex;
  const size = finish === 'carpet' ? 128 : 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  paint(finish, ctx, size);
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / TILE_M[finish], 1 / TILE_M[finish]);
  tex.anisotropy = 4;
  cache.set(finish, tex);
  return tex;
}
