import { spacePalettes, spaceTokens, springs } from '@vistar/shared';

/**
 * Space Shell ambient effects (SPEC 28.2), loaded lazily by <SpaceBackdrop> only in Depth or Neon Space,
 * so Classic never downloads it. Plain DOM and one small 2D canvas, no 3D library.
 * - Particles: dark theme only, at most spaceTokens.particles[style], drawn at 30 fps, twinkle period
 *   5-11 s (far below 3 Hz). One static frame under reduced or off motion.
 * - Parallax: [data-parallax="far|mid|near|sheen"] layers follow the pointer on a `follow` spring.
 *   Full motion and a fine pointer only.
 * - Paused while the tab is hidden. Adaptive tier: when the frame rate stays under spaceTokens.fpsFloor
 *   for two windows in a row, animation stops (static particles, no parallax).
 */

export interface SpaceEffectsOptions {
  style: 'depth' | 'neon';
  theme: 'light' | 'dark';
  motion: 'full' | 'reduced' | 'off';
}

export interface SpaceEffects {
  update(options: SpaceEffectsOptions): void;
  stop(): void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
  /** Radians per ms. */
  speed: number;
  tint: 0 | 1;
}

const DRAW_INTERVAL_MS = 33;
const WARMUP_MS = 3000;
const SPRITE_PX = 32;
const DPR_MAX = 1.5;
const PARALLAX = spaceTokens.parallax;
const FOLLOW = springs.follow;

function sprite(color: string, glow: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE_PX;
  const g = c.getContext('2d')!;
  const r = SPRITE_PX / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, color);
  grad.addColorStop(glow ? 0.18 : 0.28, color);
  grad.addColorStop(glow ? 0.45 : 0.4, color.replace(/[\d.]+\)$/, '0.12)'));
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  return c;
}

export function startSpaceEffects(backdrop: HTMLElement, scope: HTMLElement, initial: SpaceEffectsOptions): SpaceEffects {
  let opts = initial;
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let sprites: [HTMLCanvasElement, HTMLCanvasElement] | null = null;
  let particles: Particle[] = [];
  let width = 0;
  let height = 0;
  let raf = 0;
  let lastFrame = 0;
  let lastDraw = 0;
  const startedAt = performance.now();
  let fpsFrames = 0;
  let fpsStart = 0;
  let slowWindows = 0;
  let degraded = false;
  let layers: HTMLElement[] = [];
  const target = { x: 0, y: 0 };
  const pos = { x: 0, y: 0 };
  const vel = { x: 0, y: 0 };
  const finePointer = window.matchMedia('(pointer: fine)');

  const parallaxOn = () => opts.motion === 'full' && !degraded && finePointer.matches;
  const particlesOn = () => opts.theme === 'dark';
  const particlesMove = () => particlesOn() && opts.motion === 'full' && !degraded;

  function seed() {
    const count = spaceTokens.particles[opts.style];
    particles = Array.from({ length: count }, () => {
      const depth = 0.4 + Math.random() * 0.6;
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.004 * depth,
        vy: -(0.002 + Math.random() * 0.006) * depth,
        size: (opts.style === 'neon' ? 7 : 5.5) * depth + Math.random() * 3,
        alpha: 0.35 + Math.random() * 0.55,
        phase: Math.random() * Math.PI * 2,
        speed: (Math.PI * 2) / (5000 + Math.random() * 6000),
        tint: Math.random() < 0.65 ? 0 : 1,
      };
    });
  }

  function ensureCanvas() {
    if (!particlesOn()) {
      canvas?.remove();
      canvas = null;
      ctx = null;
      return;
    }
    const palette = spacePalettes[opts.style][opts.theme];
    const glow = opts.style === 'neon';
    sprites = [sprite(palette['space-particle'], glow), sprite(palette['space-particle-2'], glow)];
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'vs-backdrop__particles';
      canvas.dataset.parallax = 'near';
      canvas.setAttribute('aria-hidden', 'true');
      backdrop.insertBefore(canvas, backdrop.querySelector('.vs-backdrop__vignette'));
      ctx = canvas.getContext('2d');
      resize();
    }
    if (particles.length !== spaceTokens.particles[opts.style]) seed();
  }

  function resize() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    if (width && height) {
      for (const p of particles) {
        p.x = (p.x / width) * w;
        p.y = (p.y / height) * h;
      }
    }
    width = w;
    height = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!particles.length) seed();
    draw(performance.now());
  }

  function draw(now: number) {
    if (!ctx || !canvas || !sprites) return;
    ctx.clearRect(0, 0, width, height);
    for (const p of particles) {
      ctx.globalAlpha = p.alpha * (0.65 + 0.35 * Math.sin(p.phase + now * p.speed));
      ctx.drawImage(sprites[p.tint], p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    canvas.dataset.ready = '';
  }

  function advance(dt: number) {
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y < -p.size) {
        p.y = height + p.size;
        p.x = Math.random() * width;
      }
      if (p.x < -p.size) p.x = width + p.size;
      else if (p.x > width + p.size) p.x = -p.size;
    }
  }

  function applyParallax() {
    for (const el of layers) {
      const depth = el.dataset.parallax as keyof typeof PARALLAX;
      const amount = PARALLAX[depth] ?? 0;
      // Background layers move against the pointer; the glass sheen moves with it.
      const sign = depth === 'sheen' ? 1 : -1;
      el.style.translate = `${(sign * pos.x * amount).toFixed(2)}px ${(sign * pos.y * amount * 0.6).toFixed(2)}px`;
    }
  }

  function resetParallax() {
    target.x = target.y = pos.x = pos.y = vel.x = vel.y = 0;
    for (const el of scope.querySelectorAll<HTMLElement>('[data-parallax]')) el.style.translate = '';
  }

  function stepSpring(dt: number): boolean {
    const s = Math.min(dt, 32) / 1000;
    for (const axis of ['x', 'y'] as const) {
      const force = -FOLLOW.stiffness * (pos[axis] - target[axis]) - FOLLOW.damping * vel[axis];
      vel[axis] += (force / FOLLOW.mass) * s;
      pos[axis] += vel[axis] * s;
    }
    const moving = Math.abs(pos.x - target.x) + Math.abs(pos.y - target.y) > 0.001 || Math.abs(vel.x) + Math.abs(vel.y) > 0.001;
    applyParallax();
    return moving;
  }

  function monitor(now: number) {
    if (now - startedAt < WARMUP_MS) return;
    if (!fpsStart) {
      fpsStart = now;
      fpsFrames = 0;
      return;
    }
    fpsFrames++;
    const elapsed = now - fpsStart;
    if (elapsed < spaceTokens.fpsWindowMs) return;
    const fps = (fpsFrames * 1000) / elapsed;
    slowWindows = fps < spaceTokens.fpsFloor ? slowWindows + 1 : 0;
    fpsStart = now;
    fpsFrames = 0;
    if (slowWindows >= 2) {
      degraded = true;
      backdrop.dataset.spaceTier = 'static';
      resetParallax();
      draw(now);
    }
  }

  function loop(now: number) {
    raf = 0;
    const dt = lastFrame ? now - lastFrame : 16;
    lastFrame = now;
    let again = false;
    if (parallaxOn()) again = stepSpring(dt);
    if (particlesMove()) {
      monitor(now);
      if (now - lastDraw >= DRAW_INTERVAL_MS) {
        advance(lastDraw ? Math.min(now - lastDraw, 100) : DRAW_INTERVAL_MS);
        draw(now);
        lastDraw = now;
      }
      again = again || particlesMove();
    }
    if (again && document.visibilityState === 'visible') raf = requestAnimationFrame(loop);
    else lastFrame = 0;
  }

  function kick() {
    if (raf || document.visibilityState !== 'visible') return;
    lastDraw = 0;
    raf = requestAnimationFrame(loop);
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!parallaxOn() || e.pointerType !== 'mouse') return;
    target.x = (e.clientX / window.innerWidth) * 2 - 1;
    target.y = (e.clientY / window.innerHeight) * 2 - 1;
    if (!raf) layers = Array.from(scope.querySelectorAll<HTMLElement>('[data-parallax]'));
    kick();
  };
  const onPointerOut = (e: PointerEvent) => {
    if (e.relatedTarget || !parallaxOn()) return;
    target.x = target.y = 0;
    kick();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') kick();
    else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      lastFrame = 0;
    }
  };
  const resizeObserver = new ResizeObserver(() => resize());

  function apply() {
    ensureCanvas();
    if (canvas) {
      resizeObserver.disconnect();
      resizeObserver.observe(canvas);
    }
    if (!parallaxOn()) resetParallax();
    draw(performance.now());
    if (particlesMove()) kick();
  }

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerout', onPointerOut, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  apply();

  return {
    update(next) {
      const styleChanged = next.style !== opts.style;
      opts = next;
      if (styleChanged) particles = [];
      apply();
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('visibilitychange', onVisibility);
      resizeObserver.disconnect();
      resetParallax();
      canvas?.remove();
      canvas = null;
      delete backdrop.dataset.spaceTier;
    },
  };
}
