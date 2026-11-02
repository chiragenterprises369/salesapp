'use client';

import { spacePalettes, type SpaceTokenName } from '@vistar/shared';
import { useState, type CSSProperties } from 'react';
import type { BoardVariant } from './skin-model';

/** 28.2 space palette entries the Neon board reuses (as --vn-* on the board root and the drag overlay). */
const SPACE_KEYS: ReadonlyArray<[string, SpaceTokenName]> = [
  ['--vn-base', 'space-base'],
  ['--vn-base-2', 'space-base-2'],
  ['--vn-glow-1', 'space-glow-1'],
  ['--vn-glow-2', 'space-glow-2'],
  ['--vn-glow-3', 'space-glow-3'],
  ['--vn-grid', 'space-grid'],
  ['--vn-horizon', 'space-horizon'],
  ['--vn-vignette', 'space-vignette'],
];

/** Neon Space palette variables for the board root (dark = neon, light = aurora). */
export function neonSpaceVars(variant: BoardVariant): CSSProperties {
  const palette = spacePalettes.neon[variant === 'neon' ? 'dark' : 'light'];
  return Object.fromEntries(SPACE_KEYS.map(([name, key]) => [name, palette[key]])) as CSSProperties;
}

/**
 * Neon Space backdrop behind the columns: the pre-blurred, dimmed office plate (lazy WebP, 960 or
 * 1920 px, never a video), a tint that keeps text AA, faint perspective floor lines with a glowing
 * grid, the horizon line and a dark vignette. Static CSS; the grid drifts very slowly only under full
 * motion (neon.css). Decorative: hidden from assistive tech and from the pointer.
 */
export function NeonBackdrop({ variant }: { variant: BoardVariant }) {
  const tone = variant === 'neon' ? 'dark' : 'light';
  const [ready, setReady] = useState<string | null>(null);
  const src = `/leads-neon/office-${tone}-960.webp`;
  return (
    <div aria-hidden className="vn-backdrop" data-variant={variant}>
      {/* Pre-encoded, pre-blurred plate: the image optimiser would only re-encode it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={tone}
        className="vn-backdrop__plate"
        src={src}
        srcSet={`/leads-neon/office-${tone}-960.webp 960w, /leads-neon/office-${tone}-1920.webp 1920w`}
        sizes="80vw"
        alt=""
        loading="lazy"
        decoding="async"
        fetchPriority="low"
        data-ready={ready === tone ? '' : undefined}
        onLoad={() => setReady(tone)}
      />
      <div className="vn-backdrop__tint" />
      <div className="vn-backdrop__floor">
        <div className="vn-backdrop__grid" />
      </div>
      <div className="vn-backdrop__horizon" />
      <div className="vn-backdrop__vignette" />
    </div>
  );
}
