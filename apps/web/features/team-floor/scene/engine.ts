import type { ResolvedTheme } from '@vistar/shared';
import * as THREE from 'three';
import type { FloorLayout } from '../state/layout';
import { PathFinder } from '../state/pathfinding';
import type { FloorState, QualityTier } from '../state/types';
import { AgentSystem } from './agents';
import { CameraController, lodFor, TAGS_MIN_ZOOM } from './camera';
import { createProceduralCharacters, type CharacterModel, type LodLevel } from './characters';
import { EffectsSystem, type BubbleHit } from './effects';
import { buildEnvironment, type Environment } from './environment';
import { labelPalette, mixLook, sceneLook, type Look } from './look';
import { applyLook, createMaterials, disposeMaterials, type MaterialSet } from './materials';

/**
 * Imperative core of the 3D floor. React (R3F) owns the canvas and the frame loop; this class owns
 * every three.js object, so per-frame work never goes through React state.
 */

export interface EngineCallbacks {
  onSelect(id: string | null): void;
  onBubble(hit: BubbleHit): void;
  onLod(level: LodLevel, tagsVisible: boolean): void;
  onTierDrop(): void;
}

export interface EngineOptions {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  gl: THREE.WebGLRenderer;
  invalidate: () => void;
  layout: FloorLayout;
  capacity: number;
  callbacks: { current: EngineCallbacks };
}

const THEME_TWEEN_S = 0.4;
const DRAG_PX = 5;
const LOW_FPS = 45;
const LOW_FOR_S = 3;
const AMBIENT_FPS = 24;

export class FloorEngine {
  private readonly o: EngineOptions;
  private readonly root = new THREE.Group();
  private readonly paths: PathFinder;
  private readonly look: Look;
  private lookFrom: Look;
  private lookTo: Look;
  private tweenT = 1;
  private themed = false;
  private theme: ResolvedTheme = 'light';
  private readonly mats: MaterialSet;
  private readonly env: Environment;
  private readonly model: CharacterModel;
  private readonly agents: AgentSystem;
  private readonly effects: EffectsSystem;
  private readonly cam: CameraController;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly lamps: THREE.PointLight[] = [];
  private readonly selectRing: THREE.Mesh<THREE.RingGeometry, THREE.Material>;
  private readonly tags = new Map<string, { el: HTMLElement; x: number; y: number; shown: boolean }>();
  private readonly seenWaves = new Set<string>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly tmp = new THREE.Vector3();
  private state: FloorState | null = null;
  private selectedId: string | null = null;
  private reducedMotion = false;
  private tier: QualityTier = 'high';
  private lod: LodLevel = 'near';
  private tagsVisible = true;
  private continuous = true;
  private elapsed = 0;
  private readonly ambientTimer: ReturnType<typeof setInterval>;
  private fpsWindow = 0;
  private fpsFrames = 0;
  private lowFor = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private down: { x: number; y: number; moved: boolean } | null = null;
  private pinch: number | null = null;
  private lastHover = 0;
  private readonly el: HTMLCanvasElement;
  private disposed = false;

  constructor(o: EngineOptions) {
    this.o = o;
    this.el = o.gl.domElement;
    this.paths = new PathFinder(o.layout.grid);
    this.look = sceneLook('light');
    this.lookFrom = sceneLook('light');
    this.lookTo = sceneLook('light');
    this.mats = createMaterials(this.look);

    this.env = buildEnvironment(o.layout, this.mats);
    this.model = createProceduralCharacters(o.capacity, { blob: this.mats.blob, phone: this.mats.phone });
    this.agents = new AgentSystem(o.layout, this.paths, this.model);
    this.effects = new EffectsSystem(o.layout, this.paths, this.agents, this.mats, this.look);
    this.agents.setStatusColors(this.look.status);

    const { width: W, depth: D } = o.layout;
    this.hemi = new THREE.HemisphereLight(this.look.hemiSky, this.look.hemiGround, this.look.hemiIntensity);
    this.sun = new THREE.DirectionalLight(this.look.sun, this.look.sunIntensity);
    this.sun.position.set(W / 2 - 14, 26, D / 2 - 9);
    this.sun.target.position.set(W / 2, 0, D / 2);
    const span = Math.max(W, D) * 0.72;
    const sc = this.sun.shadow.camera;
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.near = 1;
    sc.far = 90;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 2;
    for (const l of o.layout.lights) {
      const lamp = new THREE.PointLight(this.look.lamp, this.look.lampIntensity, 11, 1.2);
      lamp.position.set(l.x, l.y, l.z);
      this.lamps.push(lamp);
    }

    const ringGeo = new THREE.RingGeometry(0.5, 0.6, 36);
    ringGeo.rotateX(-Math.PI / 2);
    this.selectRing = new THREE.Mesh(ringGeo, this.mats.select);
    this.selectRing.visible = false;
    this.selectRing.renderOrder = 4;

    this.root.add(this.env.group, this.model.object, this.effects.group, this.hemi, this.sun, this.sun.target, this.selectRing, ...this.lamps);
    o.scene.add(this.root);

    this.cam = new CameraController(o.camera, o.layout);

    this.el.addEventListener('pointerdown', this.onPointerDown);
    this.el.addEventListener('pointermove', this.onPointerMove);
    this.el.addEventListener('pointerup', this.onPointerUp);
    this.el.addEventListener('pointercancel', this.onPointerUp);
    this.el.addEventListener('pointerleave', this.onPointerLeave);
    this.el.addEventListener('wheel', this.onWheel, { passive: false });
    this.el.style.touchAction = 'none';
    this.el.style.cursor = 'grab';

    // Looping clips (typing, phone, breathing, call pulses) render at a capped rate when nothing else moves.
    this.ambientTimer = setInterval(() => {
      if (!this.continuous && !document.hidden && this.agents.ambient) this.o.invalidate();
    }, 1000 / AMBIENT_FPS);
  }

  // ---------------------------------------------------------------- inputs from React

  setFloorState(state: FloorState) {
    this.state = state;
    const waves: string[] = [];
    const live = new Set<string>();
    for (const e of state.effects) {
      if (e.kind !== 'wave') continue;
      live.add(e.id);
      if (!this.seenWaves.has(e.id)) {
        this.seenWaves.add(e.id);
        waves.push(e.userId);
      }
    }
    for (const id of this.seenWaves) if (!live.has(id)) this.seenWaves.delete(id);
    this.agents.sync(state, waves);
    this.effects.sync(state);
    this.invalidate();
  }

  setTheme(theme: ResolvedTheme, animate: boolean) {
    // The first theme after mount applies instantly; later changes tween (~400 ms).
    const instant = !animate || !this.themed || this.reducedMotion;
    if (theme === this.theme && this.themed && this.tweenT >= 1) return;
    this.themed = true;
    this.theme = theme;
    // Snapshot of the current (possibly mid-tween) look as the tween start.
    this.lookFrom = mixLook(this.look, this.look, 0, sceneLook(theme));
    this.lookTo = sceneLook(theme);
    this.tweenT = instant ? 1 : 0;
    if (instant) this.applyLookAt(1);
    const palette = labelPalette(theme);
    this.env.redrawLabels(palette);
    this.effects.setPalette(palette);
    if (this.state) this.effects.sync(this.state);
    this.invalidate();
  }

  setTier(tier: QualityTier) {
    this.tier = tier;
    const shadows = tier !== 'low' && this.o.gl.shadowMap.enabled;
    this.sun.castShadow = shadows;
    const size = tier === 'high' ? 1024 : 512;
    this.sun.shadow.radius = tier === 'high' ? 3 : 1;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.env.setShadows(shadows);
    this.model.setShadows(shadows);
    for (const l of this.lamps) l.visible = tier !== 'low';
    this.effects.setTagsMode(tier === 'high' ? 'off' : 'sprite');
    for (const m of Object.values(this.mats)) m.needsUpdate = true;
    this.invalidate();
  }

  setReducedMotion(on: boolean) {
    this.reducedMotion = on;
    this.agents.setReducedMotion(on);
    this.effects.setReducedMotion(on);
    this.invalidate();
  }

  setSelected(id: string | null) {
    this.selectedId = id;
    this.effects.setSelected(id);
    this.invalidate();
  }

  focus(id: string) {
    const pos = this.agents.positionOf(id);
    const emp = this.state?.employees[this.state.index[id] ?? -1];
    const desk = emp ? this.o.layout.desks[emp.desk] : null;
    const x = pos?.visible ? pos.x : desk?.x;
    const z = pos?.visible ? pos.z : desk?.z;
    if (x === undefined || z === undefined) return;
    this.cam.focus(x, z, this.reducedMotion);
    this.invalidate();
  }

  zoomBy(factor: number) {
    this.cam.zoomAt(factor);
    this.afterCamera();
  }

  pan(dx: number, dy: number) {
    this.cam.panPixels(dx, dy);
    this.afterCamera();
  }

  resetView() {
    this.cam.reset(this.reducedMotion);
    this.afterCamera();
  }

  resize(width: number, height: number) {
    this.cam.resize(width, height);
    this.afterCamera();
  }

  registerTag(id: string, el: HTMLElement | null) {
    if (el) this.tags.set(id, { el, x: Number.NaN, y: Number.NaN, shown: false });
    else this.tags.delete(id);
  }

  get currentLod() {
    return { level: this.lod, tagsVisible: this.tagsVisible };
  }

  // ---------------------------------------------------------------- frame

  /** One frame. Returns true when another frame should follow immediately. */
  frame(rawDt: number): boolean {
    if (this.disposed) return false;
    // Frames requested while animating continuously are measured, however slow; only a resume
    // after a hidden tab (rAF paused for seconds) is ignored.
    const resumed = rawDt > 2;
    const dt = Math.min(rawDt, 0.25);
    this.elapsed += dt;
    let moving = this.cam.update(dt);
    if (moving) this.afterCamera(false);

    if (this.tweenT < 1) {
      this.tweenT = this.reducedMotion ? 1 : Math.min(1, this.tweenT + dt / THEME_TWEEN_S);
      this.applyLookAt(this.tweenT);
      moving = true;
    }

    this.agents.update(dt);
    moving = this.agents.moving || moving;
    moving = this.effects.update(dt, this.cam.zoom, Date.now()) || moving;

    // Selection ring and DOM tags follow the characters.
    const sel = this.selectedId ? this.agents.positionOf(this.selectedId) : null;
    if (sel && sel.visible) {
      const pulse = this.reducedMotion ? 1 : 1 + 0.06 * Math.sin(this.elapsed * 4);
      this.selectRing.position.set(sel.x, 0.016, sel.z);
      this.selectRing.scale.setScalar(pulse);
      this.selectRing.visible = true;
    } else {
      this.selectRing.visible = false;
    }
    // DOM name tags (high tier) follow the heads; transforms are written only when they change.
    if (this.tags.size) {
      const { width, height } = this.cam.size;
      const cam = this.o.camera;
      cam.updateMatrixWorld();
      for (const [id, tag] of this.tags) {
        const head = this.agents.headOf(id, this.tmp);
        if (!head) {
          if (tag.shown) {
            tag.el.style.visibility = 'hidden';
            tag.shown = false;
          }
          continue;
        }
        head.project(cam);
        const x = Math.round((head.x + 1) * width) / 2;
        const y = Math.round((1 - head.y) * height) / 2;
        if (x !== tag.x || y !== tag.y) {
          tag.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          tag.x = x;
          tag.y = y;
        }
        if (!tag.shown) {
          tag.el.style.visibility = 'visible';
          tag.shown = true;
        }
      }
    }

    this.sampleFps(rawDt, this.continuous && !resumed);
    this.continuous = moving;
    return moving;
  }

  private sampleFps(dt: number, measuring: boolean) {
    if (!measuring || this.tier === 'low') {
      this.fpsWindow = 0;
      this.fpsFrames = 0;
      return;
    }
    this.fpsWindow += dt;
    this.fpsFrames += 1;
    if (this.fpsWindow < 0.5) return;
    const fps = this.fpsFrames / this.fpsWindow;
    this.lowFor = fps < LOW_FPS ? this.lowFor + this.fpsWindow : 0;
    this.fpsWindow = 0;
    this.fpsFrames = 0;
    if (this.lowFor >= LOW_FOR_S) {
      this.lowFor = 0;
      this.o.callbacks.current.onTierDrop();
    }
  }

  private applyLookAt(t: number) {
    const e = t * t * (3 - 2 * t);
    mixLook(this.lookFrom, this.lookTo, e, this.look);
    const dark = this.theme === 'dark' ? e : 1 - e;
    applyLook(this.mats, this.look, dark);
    this.hemi.color.copy(this.look.hemiSky);
    this.hemi.groundColor.copy(this.look.hemiGround);
    this.hemi.intensity = this.look.hemiIntensity;
    this.sun.color.copy(this.look.sun);
    this.sun.intensity = this.look.sunIntensity;
    for (const l of this.lamps) {
      l.color.copy(this.look.lamp);
      l.intensity = this.look.lampIntensity;
    }
    this.agents.setStatusColors(this.look.status);
    this.effects.setLook(this.look);
  }

  private afterCamera(invalidate = true) {
    const level = lodFor(this.cam.zoom);
    const tags = this.cam.zoom >= TAGS_MIN_ZOOM;
    if (level !== this.lod || tags !== this.tagsVisible) {
      this.lod = level;
      this.tagsVisible = tags;
      this.agents.setLod(level);
      this.effects.setTagsVisible(tags);
      this.o.callbacks.current.onLod(level, tags);
    }
    if (invalidate) this.invalidate();
  }

  private invalidate() {
    if (!this.disposed) this.o.invalidate();
  }

  // ---------------------------------------------------------------- pointer input

  private local(e: PointerEvent | WheelEvent) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private pickAt(x: number, y: number): { kind: 'bubble'; hit: BubbleHit } | { kind: 'agent'; id: string } | null {
    this.cam.ndc(x, y, this.ndc);
    this.raycaster.setFromCamera(this.ndc, this.o.camera);
    const bubble = this.effects.pick(this.raycaster);
    if (bubble) return { kind: 'bubble', hit: bubble };
    const slot = this.model.pick(this.raycaster);
    const id = slot >= 0 ? this.agents.idAt(slot) : null;
    if (id && this.agents.positionOf(id)?.visible) return { kind: 'agent', id };
    return null;
  }

  private readonly onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.el.setPointerCapture(e.pointerId);
    if (this.pointers.size === 1) this.down = { x: p.x, y: p.y, moved: false };
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
      if (this.down) this.down.moved = true;
    }
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    const p = this.local(e);
    const prev = this.pointers.get(e.pointerId);
    if (!prev) {
      // Hover: pointer cursor over people and bubbles (throttled).
      const now = performance.now();
      if (now - this.lastHover < 60) return;
      this.lastHover = now;
      const hit = this.pickAt(p.x, p.y);
      this.el.style.cursor = hit ? 'pointer' : 'grab';
      return;
    }
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size >= 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const { width, height } = this.cam.size;
      this.cam.zoomAt(dist / this.pinch, (a.x + b.x) / 2 - width / 2, (a.y + b.y) / 2 - height / 2);
      this.pinch = dist;
      this.afterCamera();
      return;
    }
    if (this.down && !this.down.moved && Math.hypot(p.x - this.down.x, p.y - this.down.y) > DRAG_PX) {
      this.down.moved = true;
      this.el.style.cursor = 'grabbing';
    }
    if (this.down?.moved) {
      this.cam.panPixels(p.x - prev.x, p.y - prev.y);
      this.afterCamera();
    }
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size > 0) return;
    const down = this.down;
    this.down = null;
    this.el.style.cursor = 'grab';
    if (!down || down.moved || e.type === 'pointercancel') return;
    const p = this.local(e);
    const hit = this.pickAt(p.x, p.y);
    if (!hit) this.o.callbacks.current.onSelect(null);
    else if (hit.kind === 'bubble') this.o.callbacks.current.onBubble(hit.hit);
    else this.o.callbacks.current.onSelect(hit.id);
  };

  private readonly onPointerLeave = () => {
    if (!this.pointers.size) this.el.style.cursor = '';
  };

  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
    const { width, height } = this.cam.size;
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.cam.zoomAt(Math.exp(-delta * 0.0015), p.x - width / 2, p.y - height / 2);
    this.afterCamera();
  };

  dispose() {
    this.disposed = true;
    clearInterval(this.ambientTimer);
    this.el.removeEventListener('pointerdown', this.onPointerDown);
    this.el.removeEventListener('pointermove', this.onPointerMove);
    this.el.removeEventListener('pointerup', this.onPointerUp);
    this.el.removeEventListener('pointercancel', this.onPointerUp);
    this.el.removeEventListener('pointerleave', this.onPointerLeave);
    this.el.removeEventListener('wheel', this.onWheel);
    this.o.scene.remove(this.root);
    this.env.dispose();
    this.model.dispose();
    this.effects.dispose();
    this.selectRing.geometry.dispose();
    this.sun.shadow.map?.dispose();
    disposeMaterials(this.mats);
  }
}
