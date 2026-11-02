'use client';

import { resolveCelebrations, type CelebrationIntensity, type MotionIntensity } from '@vistar/shared';
import { useMe } from '@/lib/session/session';
import { useInterfaceStore } from '@/lib/theme';
import { useReducedMotion } from '@/lib/use-reduced-motion';

export interface CelebrationSetting {
  /** The user's choice (`leads.celebrations`); null follows motion intensity. */
  setting: CelebrationIntensity | null;
  /** Effective motion: off with reduced motion (OS or setting), else the resolved motion intensity. */
  motion: MotionIntensity;
  /** Reduced motion is on (forces simple fades). */
  reduced: boolean;
  /** resolveCelebrations(setting, motion). */
  effective: CelebrationIntensity;
}

/** Board celebrations intensity for this user and device (D-052). */
export function useCelebrationSetting(): CelebrationSetting {
  const me = useMe();
  const reduced = useReducedMotion();
  const resolvedMotion = useInterfaceStore((s) => s.resolved.motion);
  const setting = me?.settings.celebrations ?? null;
  const motion: MotionIntensity = reduced ? 'off' : resolvedMotion;
  return { setting, motion, reduced, effective: resolveCelebrations(setting, motion) };
}
