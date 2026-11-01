import * as THREE from 'three';
import type { FloorLayout } from '../state/layout';
import type { LodLevel } from './characters';

/**
 * Fixed isometric orthographic camera: 45 deg yaw, 35 deg pitch, no orbit. Pan is bounded to the
 * office, zoom is 0.6x-1.8x of the "fit" zoom (extended so large floors can still be read up close).
 * `zoom` is pixels per world unit.
 */

const YAW = Math.PI / 4;
const PITCH = (35 * Math.PI) / 180;
const DISTANCE = 80;
const SIN_P = Math.sin(PITCH);

export const TAGS_MIN_ZOOM = 20;
export const FAR_MAX_ZOOM = 11;

const DIR = new THREE.Vector3(Math.cos(PITCH) * Math.sin(YAW), Math.sin(PITCH), Math.cos(PITCH) * Math.cos(YAW));
/** Screen right on the ground plane. */
const RIGHT = new THREE.Vector3(Math.cos(YAW), 0, -Math.sin(YAW));
/** Ground direction that moves up the screen. */
const GROUND_UP = new THREE.Vector3(-Math.sin(YAW), 0, -Math.cos(YAW));
const UP = new THREE.Vector3().crossVectors(RIGHT, DIR.clone().negate()).normalize();

export function lodFor(zoom: number): LodLevel {
  return zoom < FAR_MAX_ZOOM ? 'far' : zoom < TAGS_MIN_ZOOM ? 'mid' : 'near';
}

export class CameraController {
  private readonly camera: THREE.OrthographicCamera;
  private readonly layout: FloorLayout;
  zoom = 20;
  fit = 20;
  minZoom = 12;
  maxZoom = 40;
  private readonly target = new THREE.Vector3();
  private readonly home = new THREE.Vector3();
  private width = 1;
  private height = 1;
  private sized = false;
  private tween: { from: THREE.Vector3; to: THREE.Vector3; zFrom: number; zTo: number; t: number; d: number } | null = null;

  constructor(camera: THREE.OrthographicCamera, layout: FloorLayout) {
    this.camera = camera;
    this.layout = layout;
    this.target.set(layout.width / 2, 0, layout.depth / 2);
    this.home.copy(this.target);
  }

  resize(width: number, height: number) {
    if (width < 2 || height < 2) return;
    const firstFit = !this.sized;
    const ratio = this.zoom / this.fit;
    this.width = width;
    this.height = height;
    this.sized = true;

    // Screen-space extents of the office box (slab to wall tops).
    const { width: W, depth: D } = this.layout;
    const center = new THREE.Vector3(W / 2, 0, D / 2);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    const p = new THREE.Vector3();
    for (const x of [-0.25, W + 0.25]) {
      for (const z of [-0.25, D + 0.25]) {
        for (const y of [-0.45, 1.3]) {
          p.set(x, y, z).sub(center);
          const sx = p.dot(RIGHT);
          const sy = p.dot(UP);
          x0 = Math.min(x0, sx);
          x1 = Math.max(x1, sx);
          y0 = Math.min(y0, sy);
          y1 = Math.max(y1, sy);
        }
      }
    }
    this.fit = Math.max(2, Math.min(width / (x1 - x0), height / (y1 - y0)) * 0.94);
    this.minZoom = this.fit * 0.6;
    this.maxZoom = Math.max(this.fit * 1.8, 42);
    // Centre the projected box: shift the ground target by the screen offset of its middle.
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    this.home.copy(center).addScaledVector(RIGHT, cx).addScaledVector(GROUND_UP, cy / SIN_P);
    if (firstFit) {
      this.zoom = this.fit;
      this.target.copy(this.home);
    } else {
      this.zoom = THREE.MathUtils.clamp(this.fit * ratio, this.minZoom, this.maxZoom);
    }
    this.apply();
  }

  get lod(): LodLevel {
    return lodFor(this.zoom);
  }

  /** Drag by screen pixels (content follows the pointer). */
  panPixels(dx: number, dy: number) {
    this.tween = null;
    this.target.addScaledVector(RIGHT, -dx / this.zoom).addScaledVector(GROUND_UP, dy / this.zoom / SIN_P);
    this.clamp();
    this.apply();
  }

  /** Zoom by a factor around a screen point (pixels from the canvas centre). */
  zoomAt(factor: number, sx = 0, sy = 0) {
    this.tween = null;
    const next = THREE.MathUtils.clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    if (next === this.zoom) return;
    const k = 1 / this.zoom - 1 / next;
    this.target.addScaledVector(RIGHT, sx * k).addScaledVector(GROUND_UP, (-sy * k) / SIN_P);
    this.zoom = next;
    this.clamp();
    this.apply();
  }

  /** Smoothly centre a floor point (and zoom in a little if far out). */
  focus(x: number, z: number, instant: boolean) {
    const to = new THREE.Vector3(x, 0, z);
    const zTo = Math.max(this.zoom, Math.min(this.maxZoom, Math.max(this.fit * 1.25, TAGS_MIN_ZOOM + 2)));
    if (instant) {
      this.target.copy(to);
      this.zoom = zTo;
      this.clamp();
      this.apply();
      return;
    }
    this.tween = { from: this.target.clone(), to, zFrom: this.zoom, zTo, t: 0, d: 0.45 };
  }

  reset(instant: boolean) {
    if (instant) {
      this.target.copy(this.home);
      this.zoom = this.fit;
      this.apply();
      return;
    }
    this.tween = { from: this.target.clone(), to: this.home.clone(), zFrom: this.zoom, zTo: this.fit, t: 0, d: 0.4 };
  }

  /** Advance tweens; true while moving. */
  update(dt: number): boolean {
    if (!this.tween) return false;
    const tw = this.tween;
    tw.t = Math.min(1, tw.t + dt / tw.d);
    const e = 1 - (1 - tw.t) ** 3;
    this.target.lerpVectors(tw.from, tw.to, e);
    this.zoom = tw.zFrom + (tw.zTo - tw.zFrom) * e;
    this.clamp();
    this.apply();
    if (tw.t >= 1) this.tween = null;
    return true;
  }

  /** Normalised device coordinates for a pointer at canvas pixels. */
  ndc(px: number, py: number, out: THREE.Vector2) {
    return out.set((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1);
  }

  get size() {
    return { width: this.width, height: this.height };
  }

  private clamp() {
    this.target.x = THREE.MathUtils.clamp(this.target.x, -1, this.layout.width + 1);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -1, this.layout.depth + 1);
  }

  private apply() {
    const cam = this.camera;
    cam.position.copy(this.target).addScaledVector(DIR, DISTANCE);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.target);
    cam.zoom = this.zoom;
    cam.near = 0.1;
    cam.far = DISTANCE * 3;
    cam.updateProjectionMatrix();
  }
}
