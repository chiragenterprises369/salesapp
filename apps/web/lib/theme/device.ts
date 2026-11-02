'use client';

import { useSyncExternalStore } from 'react';
import {
  CAPABLE_DEVICE,
  COARSE_POINTER_QUERY,
  isLowEnd,
  NARROW_SCREEN_QUERY,
  REDUCED_MOTION_QUERY,
  type DeviceCapabilities,
} from './interface-style';

const QUERIES = [NARROW_SCREEN_QUERY, COARSE_POINTER_QUERY, REDUCED_MOTION_QUERY];

let cached: DeviceCapabilities = CAPABLE_DEVICE;
let cachedKey = '';

function read(): DeviceCapabilities {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const next: DeviceCapabilities = {
    narrowScreen: window.matchMedia(NARROW_SCREEN_QUERY).matches,
    coarsePointer: window.matchMedia(COARSE_POINTER_QUERY).matches,
    lowEnd: isLowEnd(nav.hardwareConcurrency, nav.deviceMemory),
    prefersReducedMotion: window.matchMedia(REDUCED_MOTION_QUERY).matches,
  };
  const key = `${+next.narrowScreen}${+next.coarsePointer}${+next.lowEnd}${+next.prefersReducedMotion}`;
  if (key !== cachedKey) {
    cachedKey = key;
    cached = next;
  }
  return cached;
}

function subscribe(onChange: () => void) {
  const lists = QUERIES.map((q) => window.matchMedia(q));
  lists.forEach((l) => l.addEventListener('change', onChange));
  return () => lists.forEach((l) => l.removeEventListener('change', onChange));
}

/**
 * Live device conditions for the interface-style fallback (D-052): narrow screen, coarse pointer,
 * low-end hardware and OS reduced motion. Server and hydration: a capable device (the boot script has
 * already painted the right style, and the provider corrects it right after hydration).
 */
export function useDeviceCapabilities(): DeviceCapabilities {
  return useSyncExternalStore(subscribe, read, () => CAPABLE_DEVICE);
}
