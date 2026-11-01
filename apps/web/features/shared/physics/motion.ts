import type { QualityTier } from './quality';

/**
 * One switch for how much motion and depth a physical surface shows.
 *
 * - full: springs, tilt, sheen, overshoot, stagger, depth.
 * - reduced (prefers-reduced-motion or the user's setting): no tilt, sheen, overshoot or stagger;
 *   moves become a short fade; depth visuals stay (they are not motion).
 * - flat (user's Flat mode, low-end devices): reduced + no depth (plain cards).
 * The adaptive quality tier trims "full" further (medium, low).
 */
export type MotionMode = 'full' | 'reduced' | 'flat';

export interface MotionProfile {
  mode: MotionMode;
  tier: QualityTier;
  /** Spring physics. False = instant positions with a short opacity fade. */
  springs: boolean;
  /** Tilt multiplier 0..1. */
  tilt: number;
  /** Pointer / tilt specular sheen. */
  sheen: boolean;
  /** Landing overshoot and spring-back bounce. */
  overshoot: boolean;
  /** Staggered entrances and gap waves. */
  stagger: boolean;
  /** Thickness edge + layered shadows ('lite' = one soft shadow, 'none' = flat card). */
  depth: 'full' | 'lite' | 'none';
  /** Neighbour dimming while dragging. */
  dim: boolean;
  /** Animated feedback pulses (ring, count chip, number ticks). Reduced shows them statically. */
  pulses: boolean;
}

export function resolveMotionProfile(o: { reducedMotion: boolean; flat?: boolean; tier?: QualityTier }): MotionProfile {
  const tier = o.tier ?? 'high';
  if (o.flat) {
    return { mode: 'flat', tier, springs: false, tilt: 0, sheen: false, overshoot: false, stagger: false, depth: 'none', dim: true, pulses: false };
  }
  if (o.reducedMotion) {
    return { mode: 'reduced', tier, springs: false, tilt: 0, sheen: false, overshoot: false, stagger: false, depth: tier === 'high' ? 'full' : 'lite', dim: true, pulses: false };
  }
  if (tier === 'low') {
    return { mode: 'full', tier, springs: true, tilt: 0, sheen: false, overshoot: false, stagger: false, depth: 'lite', dim: false, pulses: true };
  }
  if (tier === 'medium') {
    return { mode: 'full', tier, springs: true, tilt: 0.5, sheen: false, overshoot: true, stagger: true, depth: 'lite', dim: true, pulses: true };
  }
  return { mode: 'full', tier, springs: true, tilt: 1, sheen: true, overshoot: true, stagger: true, depth: 'full', dim: true, pulses: true };
}
