import { clampTimeScale } from './spring';

/**
 * Global physics clock: one time scale for every spring, tween and timer that goes through this
 * module (slow motion on the demo page). 1 = real time, 0.2 = five times slower.
 */
type Listener = () => void;

let timeScale = 1;
const listeners = new Set<Listener>();

export const physicsClock = {
  get timeScale(): number {
    return timeScale;
  },
  setTimeScale(next: number) {
    const v = clampTimeScale(next);
    if (v === timeScale) return;
    timeScale = v;
    for (const l of listeners) l();
  },
  /** A real-time duration stretched by the current time scale (ms in, ms out). */
  ms(durationMs: number): number {
    return durationMs / timeScale;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): number {
    return timeScale;
  },
};
