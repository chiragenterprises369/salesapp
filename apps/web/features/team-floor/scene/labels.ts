import * as THREE from 'three';
import type { LabelPalette } from './look';

/**
 * Canvas-texture labels (name tags on medium/low tiers, "Needs you" bubbles, call outcome popups,
 * room names). Sprites are counter-scaled every frame to a constant on-screen size.
 */

export interface PillSpec {
  text: string;
  /** Leading dot colour (status), optional. */
  dot?: string | null;
  /** Trailing text in tabular style (call timer), optional. */
  trailing?: string | null;
  bg: string;
  fg: string;
  border: string;
  /** Leading "!" badge colour (Needs you). */
  badge?: string | null;
  weight?: 500 | 600;
}

const SCALE = 2; // device pixels per CSS pixel for crisp text
const HEIGHT = 22;
const FONT_PX = 11;

export class PillLabel {
  readonly sprite: THREE.Sprite;
  readonly material: THREE.SpriteMaterial;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;
  private key = '';
  /** CSS pixel size of the current drawing. */
  width = 0;
  height = HEIGHT;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.renderOrder = 10;
  }

  /** Redraws only when the content changes. Returns true when redrawn. */
  draw(spec: PillSpec, font: string): boolean {
    const key = `${spec.text}|${spec.dot}|${spec.trailing}|${spec.bg}|${spec.fg}|${spec.border}|${spec.badge}|${spec.weight}`;
    if (key === this.key) return false;
    this.key = key;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return false;
    const weight = spec.weight ?? 500;
    ctx.font = `${weight} ${FONT_PX * SCALE}px ${font}`;
    const textW = ctx.measureText(spec.text).width / SCALE;
    ctx.font = `500 ${FONT_PX * SCALE}px ${font}`;
    const trailW = spec.trailing ? ctx.measureText(spec.trailing).width / SCALE + 6 : 0;
    const lead = spec.badge ? 18 : spec.dot ? 12 : 0;
    const w = Math.ceil(8 + lead + textW + trailW + 8);
    const h = HEIGHT;
    this.width = w;
    this.height = h;
    this.canvas.width = w * SCALE;
    this.canvas.height = h * SCALE;
    ctx.scale(SCALE, SCALE);
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 0.5, 0.5, w - 1, h - 1, (h - 1) / 2);
    ctx.fillStyle = spec.bg;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = spec.border;
    ctx.stroke();
    let x = 8;
    if (spec.badge) {
      ctx.beginPath();
      ctx.arc(x + 6, h / 2, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = spec.badge;
      ctx.fill();
      ctx.fillStyle = spec.bg;
      ctx.font = `700 ${10 * SCALE}px ${font}`;
      ctx.save();
      ctx.scale(1 / SCALE, 1 / SCALE);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', (x + 6) * SCALE, (h / 2 + 0.5) * SCALE);
      ctx.restore();
      x += lead;
    } else if (spec.dot) {
      ctx.beginPath();
      ctx.arc(x + 3.5, h / 2, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = spec.dot;
      ctx.fill();
      x += lead;
    }
    ctx.save();
    ctx.scale(1 / SCALE, 1 / SCALE);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = spec.fg;
    ctx.font = `${weight} ${FONT_PX * SCALE}px ${font}`;
    ctx.fillText(spec.text, x * SCALE, (h / 2 + 0.5) * SCALE);
    if (spec.trailing) {
      ctx.font = `500 ${FONT_PX * SCALE}px ${font}`;
      ctx.globalAlpha = 0.85;
      ctx.fillText(spec.trailing, (x + textW + 6) * SCALE, (h / 2 + 0.5) * SCALE);
    }
    ctx.restore();
    this.texture.needsUpdate = true;
    return true;
  }

  /** Constant on-screen size for an orthographic camera with `zoom` px per unit. */
  fit(zoom: number) {
    this.sprite.scale.set(this.width / zoom, this.height / zoom, 1);
  }

  dispose() {
    this.texture.dispose();
    this.material.dispose();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Room name painted on the floor, aligned with the screen's horizontal axis. */
export class FloorText {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;
  private readonly text: string;

  constructor(text: string, x: number, z: number, yaw: number) {
    this.text = text;
    this.canvas = document.createElement('canvas');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    // Lie flat, then turn so the baseline runs along the screen's horizontal axis.
    this.mesh.rotation.set(-Math.PI / 2, yaw, 0, 'YXZ');
    this.mesh.position.set(x, 0.006, z);
    this.mesh.renderOrder = 1;
  }

  draw(labels: LabelPalette) {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const px = 64;
    ctx.font = `600 ${px}px ${labels.font}`;
    const w = Math.ceil(ctx.measureText(this.text.toUpperCase()).width + px);
    this.canvas.width = w;
    this.canvas.height = px * 1.6;
    ctx.font = `600 ${px}px ${labels.font}`;
    ctx.fillStyle = labels.muted;
    ctx.globalAlpha = 0.9;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '6px';
    ctx.fillText(this.text.toUpperCase(), w / 2, this.canvas.height / 2);
    this.texture.needsUpdate = true;
    const worldH = 0.5;
    this.mesh.scale.set((w / this.canvas.height) * worldH, worldH, 1);
  }

  dispose() {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
