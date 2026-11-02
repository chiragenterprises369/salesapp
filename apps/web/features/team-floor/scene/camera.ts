import * as THREE from 'three';
import type { FloorLayout } from '../state/layout';
import type { LodLevel } from './characters';

/**
 * Fixed isometric orthographic camera (SPEC 12.1 item 6). Yaw and pitch come from the floor
 * template; no orbit. `fit` frames the whole office (footprint from slab to wall tops). Zoom eases
 * towards a target around the pointer; pan is limited so the office never leaves the view (none at
 * fit zoom). `focus` flies to a point, `reset` (the Fit button) flies back. `zoom` = px per metre.
 */

const DISTANCE = 120;

/** LOD thresholds relative to the fit zoom. */
const TAGS_MIN_FACTOR = 0.82;
const FAR_FACTOR = 0.55;

export class CameraController {
  private readonly camera: THREE.OrthographicCamera;
  private readonly layout: FloorLayout;
  private readonly dir: THREE.Vector3;
  private readonly right: THREE.Vector3;
  private readonly groundUp: THREE.Vector3;
  private readonly up: THREE.Vector3;
  private readonly sinP: number;
  zoom = 30;
  fit = 30;
  minZoom = 20;
  maxZoom = 120;
  private zoomTarget = 30;
  private zoomAnchor = { x: 0, y: 0 };
  private readonly target = new THREE.Vector3();
  private readonly home = new THREE.Vector3();
  /** Half extents of the office along RIGHT and GROUND_UP (metres), for pan limits. */
  private halfRight = 10;
  private halfUp = 6;
  private width = 1;
  private height = 1;
  private sized = false;
  private tween: { from: THREE.Vector3; to: THREE.Vector3; zFrom: number; zTo: number; t: number; d: number } | null = null;

  constructor(camera: THREE.OrthographicCamera, layout: FloorLayout) {
    this.camera = camera;
    this.layout = layout;
    const yaw = (layout.template.camera.yawDeg * Math.PI) / 180;
    const pitch = (layout.template.camera.pitchDeg * Math.PI) / 180;
    this.sinP = Math.sin(pitch);
    this.dir = new THREE.Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
    this.right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    this.groundUp = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.up = new THREE.Vector3().crossVectors(this.right, this.dir.clone().negate()).normalize();
    this.target.set(layout.minX + layout.width / 2, 0, layout.minZ + layout.depth / 2);
    this.home.copy(this.target);
  }

  get tagsMinZoom() {
    return this.fit * TAGS_MIN_FACTOR;
  }

  lodFor(zoom: number): LodLevel {
    return zoom < this.fit * FAR_FACTOR ? 'far' : zoom < this.tagsMinZoom ? 'mid' : 'near';
  }

  resize(width: number, height: number) {
    if (width < 2 || height < 2) return;
    const firstFit = !this.sized;
    const ratio = this.zoom / this.fit;
    const targetRatio = this.zoomTarget / this.fit;
    this.width = width;
    this.height = height;
    this.sized = true;

    const { footprint, template } = this.layout;
    const center = new THREE.Vector3(this.layout.minX + this.layout.width / 2, 0, this.layout.minZ + this.layout.depth / 2);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    const p = new THREE.Vector3();
    const top = template.camera.fitHeight;
    // Footprint plus the entrance porch, slab bottom to wall tops.
    const pts: [number, number][] = [...footprint, this.layout.template.entrance.outside];
    for (const [x, z] of pts) {
      for (const y of [-0.32, top]) {
        p.set(x, y, z).sub(center);
        const sx = p.dot(this.right);
        const sy = p.dot(this.up);
        x0 = Math.min(x0, sx);
        x1 = Math.max(x1, sx);
        y0 = Math.min(y0, sy);
        y1 = Math.max(y1, sy);
      }
    }
    const pad = 1 - template.camera.padding * 2;
    // Extra headroom at the top for name tags over the back rooms.
    const tagRoom = 26;
    this.fit = Math.max(2, Math.min((width * pad) / (x1 - x0), ((height - tagRoom) * pad) / (y1 - y0)));
    this.minZoom = this.fit * template.camera.minZoom;
    this.maxZoom = this.fit * template.camera.maxZoom;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2 + tagRoom / 2 / this.fit;
    this.home.copy(center).addScaledVector(this.right, cx).addScaledVector(this.groundUp, cy / this.sinP);
    this.halfRight = (x1 - x0) / 2;
    this.halfUp = (y1 - y0) / 2 / this.sinP;
    if (firstFit) {
      this.zoom = this.fit;
      this.zoomTarget = this.fit;
      this.target.copy(this.home);
    } else {
      this.zoom = THREE.MathUtils.clamp(this.fit * ratio, this.minZoom, this.maxZoom);
      this.zoomTarget = THREE.MathUtils.clamp(this.fit * targetRatio, this.minZoom, this.maxZoom);
    }
    this.clamp();
    this.apply();
  }

  get lod(): LodLevel {
    return this.lodFor(this.zoom);
  }

  /** Drag by screen pixels (content follows the pointer). */
  panPixels(dx: number, dy: number) {
    this.tween = null;
    this.target.addScaledVector(this.right, -dx / this.zoom).addScaledVector(this.groundUp, dy / this.zoom / this.sinP);
    this.clamp();
    this.apply();
  }

  /** Eased zoom by a factor around a screen point (pixels from the canvas centre). */
  zoomBy(factor: number, sx = 0, sy = 0, instant = false) {
    this.tween = null;
    this.zoomTarget = THREE.MathUtils.clamp(this.zoomTarget * factor, this.minZoom, this.maxZoom);
    this.zoomAnchor = { x: sx, y: sy };
    if (instant) this.stepZoom(1);
  }

  /** Smoothly centre a floor point and zoom in for a closer look (click-to-focus). */
  focus(x: number, z: number, instant: boolean, factor = 1.7) {
    const to = new THREE.Vector3(x, 0, z);
    const zTo = THREE.MathUtils.clamp(Math.max(this.zoomTarget, this.fit * factor), this.minZoom, this.maxZoom);
    this.zoomTarget = zTo;
    if (instant) {
      this.target.copy(to);
      this.zoom = zTo;
      this.clamp();
      this.apply();
      return;
    }
    this.tween = { from: this.target.clone(), to, zFrom: this.zoom, zTo, t: 0, d: 0.6 };
  }

  /** Fly back to the fitted view (the Fit button). */
  reset(instant: boolean) {
    this.zoomTarget = this.fit;
    if (instant) {
      this.tween = null;
      this.target.copy(this.home);
      this.zoom = this.fit;
      this.apply();
      return;
    }
    this.tween = { from: this.target.clone(), to: this.home.clone(), zFrom: this.zoom, zTo: this.fit, t: 0, d: 0.5 };
  }

  get atFit() {
    return Math.abs(this.zoom - this.fit) < 0.5 && this.target.distanceTo(this.home) < 0.05;
  }

  /** Advance tweens and eased zoom; true while moving. */
  update(dt: number): boolean {
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.d);
      const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
      this.target.lerpVectors(tw.from, tw.to, e);
      this.zoom = tw.zFrom + (tw.zTo - tw.zFrom) * e;
      this.clamp();
      this.apply();
      if (tw.t >= 1) this.tween = null;
      return true;
    }
    if (Math.abs(this.zoomTarget - this.zoom) > 0.01) {
      this.stepZoom(1 - Math.exp(-dt * 14));
      return true;
    }
    return false;
  }

  private stepZoom(k: number) {
    const prev = this.zoom;
    const next = Math.abs(this.zoomTarget - prev) < 0.02 ? this.zoomTarget : prev + (this.zoomTarget - prev) * k;
    // Keep the world point under the anchor fixed while zooming.
    const f = 1 / prev - 1 / next;
    this.target.addScaledVector(this.right, this.zoomAnchor.x * f).addScaledVector(this.groundUp, (-this.zoomAnchor.y * f) / this.sinP);
    this.zoom = next;
    this.clamp();
    this.apply();
  }

  /** Normalised device coordinates for a pointer at canvas pixels. */
  ndc(px: number, py: number, out: THREE.Vector2) {
    return out.set((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1);
  }

  get size() {
    return { width: this.width, height: this.height };
  }

  /** Pan limits: none at fit zoom, growing as you zoom in, so the office always fills the view. */
  private clamp() {
    const slack = Math.max(0, 1 - this.fit / this.zoom);
    const off = this.target.clone().sub(this.home);
    const r = THREE.MathUtils.clamp(off.dot(this.right), -this.halfRight * slack - 0.3, this.halfRight * slack + 0.3);
    const u = THREE.MathUtils.clamp(off.dot(this.groundUp), -this.halfUp * slack - 0.3, this.halfUp * slack + 0.3);
    this.target.copy(this.home).addScaledVector(this.right, r).addScaledVector(this.groundUp, u);
  }

  private apply() {
    const cam = this.camera;
    cam.position.copy(this.target).addScaledVector(this.dir, DISTANCE);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.target);
    cam.zoom = this.zoom;
    cam.near = 1;
    cam.far = DISTANCE * 2.2;
    cam.updateProjectionMatrix();
  }
}
