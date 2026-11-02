'use client';

import { useEffect, useEffectEvent, useRef } from 'react';
import { useDocumentTheme } from '@/lib/use-document-theme';
import { useInterfaceStore } from '@/lib/theme';
import type { SpaceEffects } from './space-effects';

/**
 * Shared background layer behind every panel shell (SPEC 28.2). Render it first inside a
 * `relative isolate` shell root. The static layers are CSS (styles/space.css) keyed on
 * <html data-interface-style>, so they paint before hydration with no flash; in Classic they are
 * display:none. Particles and parallax (space-effects.ts) load lazily, only in Depth or Neon Space.
 */
export function SpaceBackdrop() {
  const ref = useRef<HTMLDivElement>(null);
  const style = useInterfaceStore((s) => s.resolved.style);
  const motion = useInterfaceStore((s) => s.resolved.motion);
  const theme = useDocumentTheme();
  const effects = useRef<SpaceEffects | null>(null);
  const spatial = style !== 'classic';
  // Latest values at the moment the lazy module arrives.
  const start = useEffectEvent((startSpaceEffects: typeof import('./space-effects').startSpaceEffects) => {
    const el = ref.current;
    if (!el || style === 'classic') return;
    effects.current = startSpaceEffects(el, el.parentElement ?? document.body, { style, theme, motion });
  });

  useEffect(() => {
    if (!spatial) return;
    let cancelled = false;
    void import('./space-effects').then((m) => {
      if (!cancelled) start(m.startSpaceEffects);
    });
    return () => {
      cancelled = true;
      effects.current?.stop();
      effects.current = null;
    };
  }, [spatial]);

  useEffect(() => {
    if (style !== 'classic') effects.current?.update({ style, theme, motion });
  }, [style, theme, motion]);

  return (
    <div ref={ref} aria-hidden className="vs-backdrop">
      <div className="vs-backdrop__wash" data-parallax="far" />
      <div className="vs-backdrop__floor">
        <div className="vs-backdrop__grid" data-parallax="mid" />
      </div>
      <div className="vs-backdrop__horizon" />
      <div className="vs-backdrop__vignette" />
    </div>
  );
}

/** Pointer-following highlight for glass chrome. The host needs `relative isolate`; hidden in Classic. */
export function GlassSheen() {
  return (
    <span aria-hidden className="vs-sheen">
      <span className="vs-sheen__light" data-parallax="sheen" />
    </span>
  );
}
