import type { ResolvedTheme } from '@vistar/shared';
import * as THREE from 'three';
import type { FloorLayout } from '../state/layout';
import { PathFinder } from '../state/pathfinding';
import type { FloorState, QualityTier } from '../state/types';
import { AgentSystem } from './agents';
import { CameraController } from './camera';
import { createGlbCharacters, loadCharacterAssets } from './character-glb';
import { createProceduralCharacters, type CharacterModel, type LodLevel } from './characters';
import { EffectsSystem } from './effects';
import { buildFallbackEnvironment, type Environment } from './environment';
import { layoutLabels, overlappingPairs, type LabelInput, type LabelKind, type Placement, type Rect } from './label-layout';
import { cloneLook, labelPalette, mixLook, sceneLook, type Look } from './look';
import { loadOfficeAssets, Office } from './office';

/**
 * Imperative core of the 3D floor. R3F owns the canvas and the frame loop; this class owns every
 * three.js object and the DOM label layer positions, so per-frame work never goes through React.
 */

export interface EngineCallbacks {
  onSelect(id: string | null): void;
  onBubble(hit: { userId: string | null; itemIds: string[] }): void;
  onLod(level: LodLevel, tagsVisible: boolean): void;
  onTierDrop(): void;
  onReady(ready: boolean): void;
}

export interface EngineOptions {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  gl: THREE.WebGLRenderer;
  invalidate: () => void;
  layout: FloorLayout;
  capacity: number;
  callbacks: { current: EngineCallbacks };
  /** Element that contains the canvas and the label layer (for UI obstacles). */
  container: HTMLElement | null;
}

const THEME_TWEEN_S = 0.4;
const DRAG_PX = 5;
const LOW_FPS = 45;
const LOW_FOR_S = 3;
const AMBIENT_FPS = 24;
/** More name tags than this at less than CROWD_ZOOM x the fit zoom: low-priority tags start compact. */
const CROWD_TAGS = 20;
const CROWD_ZOOM = 1.5;
/** Above this head count the procedural (instanced) characters are used. */
const GLB_MAX_PEOPLE = 80;
/** Direction the key light travels (matches the Day bake: warm daylight from the upper left). */
const SUN_TRAVEL = new THREE.Vector3(1.0, -1.15, 0.12).normalize();

interface LabelEl {
  id: string;
  kind: LabelKind;
  el: HTMLElement;
  line: SVGLineElement | null;
  version: string;
  measuredAt: number;
  w: number;
  h: number;
  cw: number;
  ch: number;
  shown: boolean;
  x: number;
  y: number;
  mode: string;
}

export interface BenchmarkResult {
  frames: number;
  avgMs: number;
  p95Ms: number;
  fps: number;
}

export class FloorEngine {
  private readonly o: EngineOptions;
  private readonly root = new THREE.Group();
  private readonly paths: PathFinder;
  private readonly look: Look;
  private lookFrom: Look;
  private lookTo: Look;
  private tweenT = 1;
  /** QA: freezes the theme cross-fade at this point (0..1) for screenshots. */
  private tweenHold: number | null = null;
  private themed = false;
  private theme: ResolvedTheme = 'light';
  private office: Office | null = null;
  private fallback: Environment | null = null;
  private model: CharacterModel;
  private readonly agents: AgentSystem;
  private readonly effects: EffectsSystem;
  private readonly cam: CameraController;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  private readonly selectRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly labels = new Map<string, LabelEl>();
  private placements = new Map<string, Placement>();
  private uiRects: Rect[] = [];
  private uiRectsAt = 0;
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
  private assetsDone = false;
  private framesSinceReady = 0;
  private officeKind: 'glb' | 'fallback' | 'loading' = 'loading';
  private bench: { until: number; last: number; samples: number[]; resolve: (r: BenchmarkResult) => void } | null = null;
  private readonly seenWaves = new Set<string>();
  private screenTimer = 0;
  private hubWaiting = -1;

  constructor(o: EngineOptions) {
    this.o = o;
    this.el = o.gl.domElement;
    o.gl.toneMapping = THREE.NeutralToneMapping;
    o.gl.toneMappingExposure = 1.0;
    this.paths = new PathFinder(o.layout);
    this.look = sceneLook('light');
    this.lookFrom = cloneLook(this.look);
    this.lookTo = cloneLook(this.look);

    this.model = this.proceduralModel(o.capacity);
    this.agents = new AgentSystem(o.layout, this.paths, this.model);
    this.effects = new EffectsSystem(o.layout, this.paths, this.agents, this.look);
    this.agents.setStatusColors(this.look.status);

    const { layout } = o;
    const cx = layout.minX + layout.width / 2;
    const cz = layout.minZ + layout.depth / 2;
    this.hemi = new THREE.HemisphereLight(this.look.hemiSky, this.look.hemiGround, this.look.hemiIntensity);
    this.sun = new THREE.DirectionalLight(this.look.sun, this.look.sunIntensity);
    this.sun.position.set(cx, 0, cz).addScaledVector(SUN_TRAVEL, -40);
    this.sun.target.position.set(cx, 0, cz);
    const span = Math.max(layout.width, layout.depth) * 0.78;
    const sc = this.sun.shadow.camera;
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.near = 5;
    sc.far = 90;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    // Fill from the camera side (no shadows) so people's faces towards the viewer stay readable.
    const yaw = (layout.template.camera.yawDeg * Math.PI) / 180;
    this.fill = new THREE.DirectionalLight(this.look.fill, this.look.fillIntensity);
    this.fill.position.set(cx + Math.sin(yaw) * 30, 22, cz + Math.cos(yaw) * 30);
    this.fill.target.position.set(cx, 0, cz);

    const ringGeo = new THREE.RingGeometry(0.58, 0.68, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.selectRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: this.look.accent, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));
    this.selectRing.visible = false;
    this.selectRing.renderOrder = 4;

    this.root.add(this.effects.group, this.hemi, this.sun, this.sun.target, this.fill, this.fill.target, this.selectRing);
    this.root.visible = false;
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

    // Looping clips (typing, phone, breathing, call pulses) render at a capped rate when nothing
    // else moves. With reduced motion nothing loops; pending expiries wake the scene at 4 Hz.
    let tick = 0;
    this.ambientTimer = setInterval(() => {
      tick++;
      if (this.continuous || document.hidden) return;
      if (this.agents.ambient || (tick % 6 === 0 && (this.effects.pending || this.labels.size > 0))) this.o.invalidate();
    }, 1000 / AMBIENT_FPS);

    void this.loadAssets();
  }

  private proceduralModel(capacity: number) {
    const blob = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false });
    const phone = new THREE.MeshLambertMaterial({ color: 0x1f2329 });
    const model = createProceduralCharacters(capacity, { blob, phone });
    const dispose = model.dispose;
    model.dispose = () => {
      dispose();
      blob.dispose();
      phone.dispose();
    };
    return model;
  }

  private async loadAssets() {
    const { layout, capacity } = this.o;
    const [office, chars] = await Promise.allSettled([loadOfficeAssets(layout.id), capacity <= GLB_MAX_PEOPLE ? loadCharacterAssets() : Promise.reject(new Error('procedural'))]);
    if (this.disposed) return;
    if (office.status === 'fulfilled') {
      this.office = new Office(office.value, layout);
      this.root.add(this.office.group);
      this.officeKind = 'glb';
    } else {
      console.warn('[team-floor] office GLB failed, using the procedural office', office.reason);
      this.fallback = buildFallbackEnvironment(layout);
      this.root.add(this.fallback.group);
      this.officeKind = 'fallback';
    }
    if (chars.status === 'fulfilled') {
      const glb = createGlbCharacters(chars.value, capacity, this.look);
      this.model.dispose();
      this.model = glb;
      this.agents.setModel(glb, this.state);
      this.agents.setStatusColors(this.look.status);
    } else if (capacity <= GLB_MAX_PEOPLE) {
      console.warn('[team-floor] character GLB failed, using procedural characters', chars.reason);
    }
    this.root.add(this.model.object);
    this.assetsDone = true;
    this.root.visible = true;
    this.applyLookAt(1);
    this.setTier(this.tier);
    this.office?.drawHub(labelPalette(this.theme), this.waitingCount());
    this.invalidate();
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
    const waiting = this.waitingCount();
    if (waiting !== this.hubWaiting && this.office) {
      this.hubWaiting = waiting;
      this.office.drawHub(labelPalette(this.theme), waiting);
    }
    this.invalidate();
  }

  private waitingCount() {
    return this.state ? this.state.leadsWaiting.length + this.state.leadsWaitingExtra : 0;
  }

  setTheme(theme: ResolvedTheme, animate: boolean) {
    const instant = !animate || !this.themed || this.reducedMotion;
    if (theme === this.theme && this.themed && this.tweenT >= 1) return;
    this.themed = true;
    this.theme = theme;
    this.lookFrom = cloneLook(this.look);
    this.lookTo = sceneLook(theme);
    this.tweenT = instant ? 1 : 0;
    if (instant) this.applyLookAt(1);
    this.office?.drawHub(labelPalette(theme), this.waitingCount());
    this.invalidate();
  }

  setTier(tier: QualityTier) {
    this.tier = tier;
    const shadows = tier !== 'low' && this.o.gl.shadowMap.enabled;
    this.sun.castShadow = shadows;
    const size = tier === 'high' ? 1024 : 512;
    this.sun.shadow.radius = tier === 'high' ? 3 : 1.5;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.model.setShadows(shadows);
    this.model.setOutline(tier !== 'low', this.cam.zoom);
    this.office?.setGlowEnabled(tier !== 'low');
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
    this.invalidate();
  }

  focus(id: string) {
    const pos = this.agents.positionOf(id);
    const emp = this.state?.employees[this.state.index[id] ?? -1];
    const home = emp ? this.o.layout.homes[emp.desk] : null;
    const x = pos?.visible ? pos.x : home?.x;
    const z = pos?.visible ? pos.z : home?.z;
    if (x === undefined || z === undefined) return;
    this.cam.focus(x, z, this.reducedMotion);
    this.invalidate();
  }

  /** Fly to a floor point with a zoom factor relative to the fit (QA: room close-ups). */
  focusPoint(x: number, z: number, factor: number) {
    this.cam.focus(x, z, this.reducedMotion, factor);
    this.invalidate();
  }

  zoomBy(factor: number) {
    this.cam.zoomBy(factor, 0, 0, this.reducedMotion);
    this.afterCamera();
  }

  pan(dx: number, dy: number) {
    this.cam.panPixels(dx, dy);
    this.afterCamera();
  }

  /** The Fit button: fly back to the whole office. */
  resetView() {
    this.cam.reset(this.reducedMotion);
    this.afterCamera();
  }

  resize(width: number, height: number) {
    this.cam.resize(width, height);
    this.uiRectsAt = 0;
    this.afterCamera();
  }

  registerLabel(id: string, kind: LabelKind, el: HTMLElement | null, line: SVGLineElement | null = null) {
    if (!el) {
      this.labels.delete(id);
      this.placements.delete(id);
      return;
    }
    const cur = this.labels.get(id);
    if (cur && cur.el === el) {
      cur.line = line ?? cur.line;
      return;
    }
    this.labels.set(id, { id, kind, el, line, version: '', measuredAt: 0, w: 0, h: 0, cw: 0, ch: 0, shown: false, x: Number.NaN, y: Number.NaN, mode: '' });
    this.invalidate();
  }

  /** Current Day/Evening blend (0 = Day bake, 1 = Evening bake). */
  get lightMix() {
    return this.look.lightMix;
  }

  /** QA: hold the theme cross-fade at 	 (0..1) of the last switch, or release it with null. */
  holdThemeTween(t: number | null) {
    this.tweenHold = t === null ? null : Math.max(0, Math.min(1, t));
    if (t === null) this.applyLookAt(this.tweenT);
    this.invalidate();
  }

  get currentLod() {
    return { level: this.lod, tagsVisible: this.tagsVisible };
  }

  get ready() {
    return this.assetsDone && this.framesSinceReady > 3 && !!this.state;
  }

  info() {
    const ext = this.o.gl.getContext().getExtension('WEBGL_debug_renderer_info');
    const gl = this.o.gl.getContext();
    return {
      renderer: String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
      tier: this.tier,
      template: this.o.layout.id,
      theme: this.theme,
      lightMix: Math.round(this.look.lightMix * 100) / 100,
      people: this.state?.employees.length ?? 0,
      office: this.officeKind,
      characters: this.model.kind,
      zoom: Math.round(this.cam.zoom * 100) / 100,
      fit: Math.round(this.cam.fit * 100) / 100,
      drawCalls: this.o.gl.info.render.calls,
      triangles: this.o.gl.info.render.triangles,
      pixelRatio: this.o.gl.getPixelRatio(),
      canvas: { width: this.cam.size.width, height: this.cam.size.height },
    };
  }

  /** Visible label rectangles in canvas CSS px (QA hook). */
  labelRects() {
    return [...this.placements.values()].filter((p) => p.mode !== 'hidden').map((p) => ({ id: p.id, kind: p.kind, mode: p.mode, leader: p.leader, x: p.x, y: p.y, w: p.w, h: p.h }));
  }

  labelOverlaps() {
    return overlappingPairs([...this.placements.values()], 0);
  }

  /** Renders continuously for `ms` and reports frame intervals (QA hook). */
  benchmark(ms: number): Promise<BenchmarkResult> {
    return new Promise((resolve) => {
      this.bench = { until: performance.now() + ms, last: 0, samples: [], resolve };
      this.invalidate();
    });
  }

  // ---------------------------------------------------------------- frame

  /** One frame. Returns true when another frame should follow immediately. */
  frame(rawDt: number): boolean {
    if (this.disposed) return false;
    const resumed = rawDt > 2;
    const dt = Math.min(rawDt, 0.25);
    this.elapsed += dt;
    let moving = this.cam.update(dt);
    if (moving) this.afterCamera(false);

    if (this.tweenHold !== null) {
      this.applyLookAt(this.tweenHold);
    } else if (this.tweenT < 1) {
      this.tweenT = this.reducedMotion ? 1 : Math.min(1, this.tweenT + dt / THEME_TWEEN_S);
      this.applyLookAt(this.tweenT);
      moving = true;
    }

    this.agents.update(dt);
    moving = this.agents.moving || moving;
    moving = this.effects.update(dt) || moving;

    const sel = this.selectedId ? this.agents.positionOf(this.selectedId) : null;
    if (sel && sel.visible) {
      const pulse = this.reducedMotion ? 1 : 1 + 0.05 * Math.sin(this.elapsed * 4);
      this.selectRing.position.set(sel.x, 0.022, sel.z);
      this.selectRing.scale.setScalar(pulse);
      this.selectRing.visible = true;
    } else {
      this.selectRing.visible = false;
    }

    this.screenTimer -= dt;
    if (this.office && this.screenTimer <= 0) {
      this.screenTimer = 0.5;
      for (const home of this.o.layout.homes) if (home.screen) this.office.setScreen(home.screen, 0.08);
      for (const [screen, level] of this.agents.screens()) this.office.setScreen(screen, level);
    }

    this.placeLabels();

    if (this.assetsDone && this.state) {
      if (this.framesSinceReady === 3) this.o.callbacks.current.onReady(true);
      this.framesSinceReady++;
    }

    if (this.bench) {
      const now = performance.now();
      if (this.bench.last) this.bench.samples.push(now - this.bench.last);
      this.bench.last = now;
      if (now >= this.bench.until) {
        const s = [...this.bench.samples].sort((a, b) => a - b);
        const avg = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
        const p95 = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] ?? 0;
        this.bench.resolve({ frames: s.length, avgMs: Math.round(avg * 100) / 100, p95Ms: Math.round(p95 * 100) / 100, fps: Math.round((1000 / Math.max(0.001, avg)) * 10) / 10 });
        this.bench = null;
      } else {
        moving = true;
      }
    }

    this.sampleFps(rawDt, this.continuous && !resumed && !this.bench);
    this.continuous = moving;
    return moving;
  }

  // ---------------------------------------------------------------- labels

  private refreshUiRects() {
    const now = performance.now();
    if (now - this.uiRectsAt < 2000) return;
    this.uiRectsAt = now;
    const box = this.el.getBoundingClientRect();
    const out: Rect[] = [];
    this.o.container?.querySelectorAll<HTMLElement>('[data-floor-ui]').forEach((ui) => {
      const r = ui.getBoundingClientRect();
      if (r.width && r.height) out.push({ x: r.left - box.left - 2, y: r.top - box.top - 2, w: r.width + 4, h: r.height + 4 });
    });
    this.uiRects = out;
  }

  private placeLabels() {
    if (!this.labels.size) return;
    const state = this.state;
    const { width, height } = this.cam.size;
    const cam = this.o.camera;
    cam.updateMatrixWorld();
    this.refreshUiRects();
    const inputs: LabelInput[] = [];
    const heads: Rect[] = [];
    const anchors = new Map<string, { x: number; y: number }>();
    const project = (v: THREE.Vector3) => {
      v.project(cam);
      return { x: ((v.x + 1) * width) / 2, y: ((1 - v.y) * height) / 2 };
    };
    const headAnchor = (userId: string) => {
      let a = anchors.get(userId);
      if (a !== undefined) return a;
      const head = this.agents.headOf(userId, this.tmp);
      a = head ? project(head) : (null as unknown as { x: number; y: number });
      anchors.set(userId, a);
      return a;
    };
    if (state && this.assetsDone) {
      for (const emp of state.employees) {
        const a = headAnchor(emp.id);
        if (a) heads.push({ x: a.x - 9, y: a.y + 2, w: 18, h: 20 });
      }
    }
    const attention = new Set<string>();
    if (state) for (const item of state.attention) attention.add(item.userId ?? '');
    const crowded = !!state && this.tagsVisible && state.employees.length > CROWD_TAGS && this.cam.zoom < this.cam.fit * CROWD_ZOOM;

    for (const l of this.labels.values()) {
      if (!this.assetsDone || !state) {
        this.hideLabel(l);
        continue;
      }
      if (l.version !== (l.el.dataset.v ?? '') || (l.el.dataset.live !== undefined && this.elapsed - l.measuredAt > 0.5)) this.measure(l);
      const user = l.el.dataset.user ?? '';
      let anchor: { x: number; y: number } | null = null;
      let priority = 3;
      if (l.kind === 'tag') {
        const emp = state.employees[state.index[user] ?? -1];
        const selected = user === this.selectedId;
        if (!emp || (!this.tagsVisible && !selected)) {
          this.hideLabel(l);
          continue;
        }
        anchor = headAnchor(user);
        priority = selected ? 0 : attention.has(user) ? 1 : emp.status === 'on_call' ? 2 : emp.status === 'offline' ? 4 : 3;
      } else {
        // Bubbles: above the person, or above the manager cabin for team items.
        if (user) anchor = headAnchor(user);
        if (!anchor) {
          const emp = user ? state.employees[state.index[user] ?? -1] : null;
          const spot = emp ? this.o.layout.homes[emp.desk] : this.o.layout.cabinSeat;
          if (spot) anchor = project(this.tmp.set(spot.x, 1.5, spot.z));
        }
        priority = l.el.dataset.priority ? Number(l.el.dataset.priority) : 1;
      }
      if (!anchor) {
        this.hideLabel(l);
        continue;
      }
      const hasTag = l.kind !== 'tag' && user && this.labels.has(`tag:${user}`) && this.tagsVisible;
      inputs.push({
        id: l.id,
        kind: l.kind,
        priority,
        ax: anchor.x,
        ay: anchor.y,
        w: l.w,
        h: l.h,
        cw: l.kind === 'tag' ? l.cw : undefined,
        ch: l.kind === 'tag' ? l.ch : undefined,
        lane: hasTag ? 22 + 3 : 0,
        compactOnly: crowded && l.kind === 'tag' && priority >= 3,
      });
    }
    const result = layoutLabels(inputs, { width, height, blocked: this.uiRects, heads, previous: this.placements });
    const next = new Map<string, Placement>();
    for (const p of result) {
      next.set(p.id, p);
      const l = this.labels.get(p.id);
      if (l) this.applyPlacement(l, p);
    }
    for (const l of this.labels.values()) if (!next.has(l.id)) this.hideLabel(l);
    this.placements = next;
  }

  private measure(l: LabelEl) {
    l.version = l.el.dataset.v ?? '';
    l.measuredAt = this.elapsed;
    const full = l.el.querySelector<HTMLElement>('[data-variant="full"]') ?? l.el;
    const compact = l.el.querySelector<HTMLElement>('[data-variant="compact"]');
    l.w = Math.ceil(full.offsetWidth);
    l.h = Math.ceil(full.offsetHeight);
    l.cw = compact ? Math.ceil(compact.offsetWidth) : l.w;
    l.ch = compact ? Math.ceil(compact.offsetHeight) : l.h;
  }

  private hideLabel(l: LabelEl) {
    if (l.shown) {
      l.el.style.visibility = 'hidden';
      l.shown = false;
    }
    if (l.line && l.line.style.visibility !== 'hidden') l.line.style.visibility = 'hidden';
  }

  private applyPlacement(l: LabelEl, p: Placement) {
    if (p.mode === 'hidden') {
      this.hideLabel(l);
      return;
    }
    if (p.x !== l.x || p.y !== l.y) {
      l.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      l.x = p.x;
      l.y = p.y;
    }
    if (p.mode !== l.mode) {
      l.el.dataset.mode = p.mode;
      l.mode = p.mode;
    }
    if (!l.shown) {
      l.el.style.visibility = 'visible';
      l.shown = true;
    }
    if (l.line) {
      if (p.leader) {
        const tx = Math.max(p.x + 6, Math.min(p.x + p.w - 6, p.ax));
        const ty = p.ay < p.y ? p.y : p.y + p.h;
        l.line.setAttribute('x1', String(Math.round(p.ax)));
        l.line.setAttribute('y1', String(Math.round(p.ay)));
        l.line.setAttribute('x2', String(Math.round(tx)));
        l.line.setAttribute('y2', String(Math.round(ty)));
        l.line.style.visibility = 'visible';
      } else if (l.line.style.visibility !== 'hidden') {
        l.line.style.visibility = 'hidden';
      }
    }
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
    this.hemi.color.copy(this.look.hemiSky);
    this.hemi.groundColor.copy(this.look.hemiGround);
    this.hemi.intensity = this.look.hemiIntensity;
    this.sun.color.copy(this.look.sun);
    this.sun.intensity = this.look.sunIntensity;
    this.fill.color.copy(this.look.fill);
    this.fill.intensity = this.look.fillIntensity;
    this.office?.setLook(this.look);
    this.model.setLook(this.look);
    this.agents.setStatusColors(this.look.status);
    this.effects.setLook(this.look);
    this.selectRing.material.color.copy(this.look.accent);
  }

  private afterCamera(invalidate = true) {
    const level = this.cam.lodFor(this.cam.zoom);
    const tags = this.cam.zoom >= this.cam.tagsMinZoom;
    if (level !== this.lod || tags !== this.tagsVisible) {
      this.lod = level;
      this.tagsVisible = tags;
      this.agents.setLod(level);
      this.o.callbacks.current.onLod(level, tags);
    }
    this.model.setOutline(this.tier !== 'low', this.cam.zoom);
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

  private pickAt(x: number, y: number): string | null {
    this.cam.ndc(x, y, this.ndc);
    this.raycaster.setFromCamera(this.ndc, this.o.camera);
    const slot = this.model.pick(this.raycaster);
    const id = slot >= 0 ? this.agents.idAt(slot) : null;
    return id && this.agents.positionOf(id)?.visible ? id : null;
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
      const now = performance.now();
      if (now - this.lastHover < 60) return;
      this.lastHover = now;
      this.el.style.cursor = this.pickAt(p.x, p.y) ? 'pointer' : 'grab';
      return;
    }
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size >= 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const { width, height } = this.cam.size;
      this.cam.zoomBy(dist / this.pinch, (a.x + b.x) / 2 - width / 2, (a.y + b.y) / 2 - height / 2, true);
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
    const id = this.pickAt(p.x, p.y);
    this.o.callbacks.current.onSelect(id);
    // Click-to-focus: fly to the person.
    if (id) this.focus(id);
  };

  private readonly onPointerLeave = () => {
    if (!this.pointers.size) this.el.style.cursor = '';
  };

  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
    const { width, height } = this.cam.size;
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.cam.zoomBy(Math.exp(-delta * 0.0018), p.x - width / 2, p.y - height / 2, this.reducedMotion);
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
    this.office?.dispose();
    this.fallback?.dispose();
    this.model.dispose();
    this.effects.dispose();
    this.selectRing.geometry.dispose();
    this.selectRing.material.dispose();
    this.sun.shadow.map?.dispose();
    this.bench?.resolve({ frames: 0, avgMs: 0, p95Ms: 0, fps: 0 });
  }
}
