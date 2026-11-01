'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { physicsClock } from './clock';
import type { QualityMonitor, QualitySnapshot } from './quality';

/** Current physics time scale (1 = real time). */
export function useTimeScale(): number {
  return useSyncExternalStore(physicsClock.subscribe, physicsClock.getSnapshot, () => 1);
}

const SERVER_QUALITY: QualitySnapshot = { tier: 'high', autoTier: 'high', forced: null, fps: null, frameMs: null, worstMs: null, sampling: false };

/** Live quality snapshot of a monitor (tier, last measured fps). */
export function useQuality(monitor: QualityMonitor): QualitySnapshot {
  return useSyncExternalStore(monitor.subscribe, monitor.getSnapshot, () => SERVER_QUALITY);
}

function subscribeVisibility(cb: () => void) {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
}

/** False while the tab is hidden (pause idle animations and simulations). */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => !document.hidden,
    () => true,
  );
}

export interface FrameRate {
  fps: number;
  /** Average and worst frame time over the last window (ms). */
  avgMs: number;
  worstMs: number;
}

/**
 * Continuous frame-rate readout (demo pages). Samples with rAF while `enabled` and the tab is
 * visible; reports every `windowMs`.
 */
export function useFrameRate(enabled = true, windowMs = 500): FrameRate | null {
  const [rate, setRate] = useState<FrameRate | null>(null);
  const visible = usePageVisible();
  useEffect(() => {
    if (!enabled || !visible) return;
    let raf = 0;
    let last = 0;
    let start = 0;
    let n = 0;
    let sum = 0;
    let worst = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (last) {
        const dt = now - last;
        if (dt < 250) {
          n++;
          sum += dt;
          worst = Math.max(worst, dt);
        }
      } else start = now;
      last = now;
      if (now - start >= windowMs && n > 0) {
        const avg = sum / n;
        setRate({ fps: Math.round(1000 / avg), avgMs: Math.round(avg * 10) / 10, worstMs: Math.round(worst * 10) / 10 });
        start = now;
        n = 0;
        sum = 0;
        worst = 0;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, visible, windowMs]);
  return enabled ? rate : null;
}
