'use client';

import gsap from 'gsap';

/**
 * Rivet Motion Engine:
 * - Magnetic pointer interaction on primary and action buttons
 * - Asymmetric fluid sliding nav pill with dual easing
 * - Staggered choreography for page enter (titles rise, cards cascade)
 * - Number count-up animation
 */

export function isReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.getAttribute('data-reduced-motion') === 'on' ||
    document.documentElement.getAttribute('data-motion') === 'off'
  );
}

/**
 * Magnetic button interaction:
 * Moves element towards pointer on pointermove with physics dampening, snaps back on pointerleave.
 */
export function initMagnetic(el: HTMLElement): () => void {
  if (isReducedMotion()) return () => {};
  if ((el as unknown as { __rivet_mag?: boolean }).__rivet_mag) return () => {};
  (el as unknown as { __rivet_mag?: boolean }).__rivet_mag = true;

  const xTo = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3.out' });
  const yTo = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3.out' });

  const onPointerMove = (e: PointerEvent) => {
    if (isReducedMotion()) return;
    const rect = el.getBoundingClientRect();
    const xDist = (e.clientX - rect.left - rect.width / 2) * 0.22;
    const yDist = (e.clientY - rect.top - rect.height / 2) * 0.26;
    xTo(xDist);
    yTo(yDist);
  };

  const onPointerLeave = () => {
    xTo(0);
    yTo(0);
  };

  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerleave', onPointerLeave);

  return () => {
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerleave', onPointerLeave);
    gsap.killTweensOf(el);
  };
}

/**
 * Attaches magnetic interaction to all eligible buttons in a container.
 */
export function attachMagneticListeners(root: ParentNode = document): () => void {
  if (typeof window === 'undefined' || isReducedMotion()) return () => {};

  const selectors = [
    '.magnetic',
    '[data-magnetic]',
    '[data-slot="button"][data-variant="primary"]',
    '.btn--neon',
  ].join(',');

  const elements = root.querySelectorAll<HTMLElement>(selectors);
  const cleanups: Array<() => void> = [];

  elements.forEach((el) => {
    cleanups.push(initMagnetic(el));
  });

  return () => {
    cleanups.forEach((c) => c());
  };
}

/**
 * Global click spring micro-interaction from Rivet:
 * Snappy tactile spring bounce on buttons, segmented pills, tabs, and action elements.
 */
export function attachGlobalClickAnimation(root: ParentNode = document): () => void {
  if (typeof window === 'undefined' || isReducedMotion()) return () => {};

  const onClick = (e: MouseEvent) => {
    if (isReducedMotion()) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;

    // Find closest clickable target
    const clickable = target.closest<HTMLElement>(
      'button, [data-slot="button"], .btn, .tabs__item, .seg__btn, [data-slot="nav-item"], .clickable'
    );
    if (!clickable) return;

    // Check if element has opted out
    if (clickable.dataset.noSpring === 'true') return;

    // Spring scale target
    gsap.fromTo(
      clickable,
      { scale: 0.94 },
      { scale: 1, duration: 0.45, ease: 'back.out(2.5)', overwrite: 'auto', clearProps: 'transform' }
    );

    // Spring scale inner icon if present
    const icon = clickable.querySelector('svg');
    if (icon) {
      gsap.fromTo(
        icon,
        { scale: 0.75 },
        { scale: 1, duration: 0.5, ease: 'back.out(3)', overwrite: true, clearProps: 'transform' }
      );
    }
  };

  root.addEventListener('click', onClick as EventListener, { capture: true, passive: true });

  return () => {
    root.removeEventListener('click', onClick as EventListener, { capture: true });
  };
}

/**
 * Animate tab section content entrance on tab change (smooth fade + glide)
 */
export function animateTabContent(el: HTMLElement | null): void {
  if (!el || isReducedMotion()) return;
  gsap.fromTo(
    el,
    { opacity: 0, y: 12 },
    { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out', clearProps: 'transform,opacity' }
  );
}

interface InsetBox {
  t: number;
  r: number;
  b: number;
  l: number;
}

/**
 * Sliding Navigation Pill:
 * Fluidly translates and morphs the active indicator pill behind navigation items.
 * Uses Rivet's dual easing: power3.out on leading edge, power3.inOut on trailing edge.
 */
export function animateNavPill(
  pillEl: HTMLElement,
  containerEl: HTMLElement,
  targetEl: HTMLElement | null,
  immediate = false,
  radius = 10,
): void {
  if (!targetEl || !targetEl.offsetWidth) {
    gsap.set(pillEl, { opacity: 0 });
    return;
  }

  const cWidth = containerEl.clientWidth;
  const cHeight = containerEl.clientHeight;
  const s: InsetBox = {
    l: targetEl.offsetLeft,
    r: cWidth - (targetEl.offsetLeft + targetEl.offsetWidth),
    t: targetEl.offsetTop,
    b: cHeight - (targetEl.offsetTop + targetEl.offsetHeight),
  };

  const toClip = (b: InsetBox) => `inset(${b.t}px ${b.r}px ${b.b}px ${b.l}px round ${radius}px)`;

  const stateHolder = pillEl as unknown as { __pillState?: InsetBox };
  const prev = stateHolder.__pillState;

  if (immediate || isReducedMotion() || !prev || Number(gsap.getProperty(pillEl, 'opacity')) === 0) {
    stateHolder.__pillState = { ...s };
    gsap.killTweensOf(pillEl);
    gsap.set(pillEl, { clipPath: toClip(s), opacity: 1 });
    return;
  }

  const currentBox = { ...prev };
  stateHolder.__pillState = currentBox;
  gsap.killTweensOf(currentBox);

  const isVertical = Math.abs(s.t - prev.t) > Math.abs(s.l - prev.l);
  const movingForward = isVertical ? s.t > prev.t : s.l > prev.l;

  const leadKey: keyof InsetBox = isVertical
    ? movingForward ? 'b' : 't'
    : movingForward ? 'r' : 'l';

  const trailKey: keyof InsetBox = isVertical
    ? movingForward ? 't' : 'b'
    : movingForward ? 'l' : 'r';

  const cross1: keyof InsetBox = isVertical ? 'l' : 't';
  const cross2: keyof InsetBox = isVertical ? 'r' : 'b';

  const onUpdate = () => {
    gsap.set(pillEl, { clipPath: toClip(currentBox), opacity: 1 });
  };

  // Leading edge accelerates fast
  gsap.to(currentBox, {
    [leadKey]: s[leadKey],
    duration: 0.36,
    ease: 'power3.out',
    onUpdate,
  });

  // Trailing edge glides with elastic inOut
  gsap.to(currentBox, {
    [trailKey]: s[trailKey],
    duration: 0.55,
    ease: 'power3.inOut',
    onUpdate,
  });

  // Cross axis adjusts smoothly
  gsap.to(currentBox, {
    [cross1]: s[cross1],
    [cross2]: s[cross2],
    duration: 0.45,
    ease: 'power3.inOut',
    onUpdate,
  });
}

/**
 * Page View Entrance Choreography:
 * Staggers entrance of titles and cards upon entering a route or room.
 */
export function animatePageEntrance(container: HTMLElement): void {
  if (isReducedMotion()) return;

  // Animate headings
  const titles = container.querySelectorAll<HTMLElement>(
    'h1, h2, [data-slot="page-title"], .head__title'
  );
  if (titles.length) {
    gsap.fromTo(
      titles,
      { opacity: 0, y: 16, rotate: 1 },
      { opacity: 1, y: 0, rotate: 0, duration: 0.65, ease: 'power3.out', stagger: 0.05, clearProps: 'transform,opacity' }
    );
  }

  // Animate cards & KPI panels
  const cards = container.querySelectorAll<HTMLElement>(
    '[data-slot="card"], .card, .kpi, [data-slot="kpi-card"]'
  );
  if (cards.length) {
    gsap.fromTo(
      cards,
      { opacity: 0, y: 24, scale: 0.985 },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.55,
        ease: 'power3.out',
        stagger: 0.04,
        clearProps: 'transform,opacity',
      }
    );
  }
}

/**
 * Animated number count up:
 */
export function animateCounter(
  el: HTMLElement,
  endValue: number,
  options: {
    duration?: number;
    delay?: number;
    format?: (v: number) => string;
  } = {}
): void {
  if (isReducedMotion()) {
    const fmt = options.format ?? ((v) => Math.round(v).toLocaleString());
    el.textContent = fmt(endValue);
    return;
  }

  const duration = options.duration ?? 0.85;
  const delay = options.delay ?? 0;
  const fmt = options.format ?? ((v) => Math.round(v).toLocaleString());

  const state = { value: 0 };
  gsap.to(state, {
    value: endValue,
    duration,
    delay,
    ease: 'power3.out',
    onUpdate: () => {
      el.textContent = fmt(state.value);
    },
    onComplete: () => {
      el.textContent = fmt(endValue);
    },
  });
}
