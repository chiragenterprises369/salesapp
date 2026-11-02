'use client';

import type { TeamFloorMode } from '@vistar/shared';
import { useSyncExternalStore } from 'react';
import type { TemplateId } from './template';
import type { QualityTier } from './types';

/**
 * Client environment helpers for the Team Floor. No three.js here: this module is part of the
 * light entry chunk and decides whether the 3D bundle is loaded at all.
 */

export interface GpuCapabilities {
  webgl: boolean;
  tier: QualityTier;
  renderer: string;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/i;
const WEAK_GPU = /mali-[t4]|adreno \(tm\) [1-5]\d\d|powervr|sgx|intel\(r\) (hd|uhd) graphics [1-6]\d{2}\b|gma/i;
const STRONG_GPU = /nvidia|geforce|quadro|rtx|radeon (rx|pro)|apple m\d|apple gpu|arc a\d/i;

/** GPU tier from a throwaway WebGL context (renderer string, limits, CPU cores, device memory). */
export function detectGpu(): GpuCapabilities {
  if (typeof document === 'undefined') return { webgl: false, tier: 'low', renderer: '' };
  try {
    const canvas = document.createElement('canvas');
    const strict = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    const gl = strict ?? canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return { webgl: false, tier: 'low', renderer: '' };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const maxTexture = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
    gl.getExtension('WEBGL_lose_context')?.loseContext();

    const nav = navigator as Navigator & { deviceMemory?: number };
    const cores = nav.hardwareConcurrency ?? 4;
    const memory = nav.deviceMemory ?? 8;
    let tier: QualityTier = 'medium';
    if (!strict || SOFTWARE.test(renderer) || WEAK_GPU.test(renderer) || cores <= 2 || memory <= 2 || maxTexture < 4096) tier = 'low';
    else if (STRONG_GPU.test(renderer) && cores >= 8 && memory >= 8) tier = 'high';
    return { webgl: true, tier, renderer };
  } catch {
    return { webgl: false, tier: 'low', renderer: '' };
  }
}

function subscribeMedia(query: string) {
  return (callback: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener('change', callback);
    return () => mql.removeEventListener('change', callback);
  };
}

const mediaSubscribers = new Map<string, (cb: () => void) => () => void>();

export function useMediaQuery(query: string, serverValue = false): boolean {
  let subscribe = mediaSubscribers.get(query);
  if (!subscribe) {
    subscribe = subscribeMedia(query);
    mediaSubscribers.set(query, subscribe);
  }
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

const noopSubscribe = () => () => {};

/** False during SSR and hydration, true afterwards. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

const visibilitySubscribe = (cb: () => void) => {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
};

export function usePageVisible(): boolean {
  return useSyncExternalStore(
    visibilitySubscribe,
    () => !document.hidden,
    () => true,
  );
}

// ---------------------------------------------------------------- shared 1 s clock

let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

function clockSubscribe(cb: () => void) {
  clockListeners.add(cb);
  if (!clockTimer) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    clockListeners.delete(cb);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

function clockSnapshot() {
  if (clockNow === 0) clockNow = Date.now();
  return clockNow;
}

/** Wall clock that ticks once per second (shared timer for call timers and relative times). */
export function useNow(): number {
  return useSyncExternalStore(clockSubscribe, clockSnapshot, () => 0);
}

// ---------------------------------------------------------------- dev params

export interface FloorDevParams {
  /** ?floorStress=200 pads the floor with synthetic employees. */
  stress: number;
  /** ?floorMode=3d|flat|auto overrides the requested mode. */
  mode: TeamFloorMode | null;
  /** ?floorTier=high|medium|low overrides GPU detection. */
  tier: QualityTier | null;
  /** ?floorTemplate=small|medium|large overrides the head-count rule. */
  template: TemplateId | null;
}

const NO_DEV: FloorDevParams = { stress: 0, mode: null, tier: null, template: null };

/**
 * QA switch: on in development, and in production builds only when localStorage
 * `vistar.floor.qa` = "1" (set by the e2e/team-floor scripts). It enables the ?floor* URL
 * overrides and the read-only `window.__vistarFloor` hook (ready state, label rects, frame timing).
 */
export function qaEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (process.env.NODE_ENV !== 'production') return true;
  try {
    return window.localStorage.getItem('vistar.floor.qa') === '1';
  } catch {
    return false;
  }
}

/** Dev/QA-only URL overrides (ignored in production builds unless qaEnabled()). */
export function readDevParams(): FloorDevParams {
  if (!qaEnabled()) return NO_DEV;
  const q = new URLSearchParams(window.location.search);
  const stress = Math.min(200, Math.max(0, Number.parseInt(q.get('floorStress') ?? '0', 10) || 0));
  const m = q.get('floorMode');
  const t = q.get('floorTier');
  const tpl = q.get('floorTemplate');
  return {
    stress,
    mode: m === '3d' || m === 'flat' || m === 'auto' ? m : null,
    tier: t === 'high' || t === 'medium' || t === 'low' ? t : null,
    template: tpl === 'small' || tpl === 'medium' || tpl === 'large' ? tpl : null,
  };
}
