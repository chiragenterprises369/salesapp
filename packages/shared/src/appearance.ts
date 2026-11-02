import type { BoardSkin, CelebrationIntensity, InterfaceStyle, MotionIntensity } from './enums.js';

/**
 * Appearance resolution (SPEC 28.1, 28.2, D-052). Pure functions shared by web and tests.
 * Inputs are the stored choices (UserSettings, Workspace defaults) plus what the device can do.
 */

/** What the current device allows. The web app measures these; the server never does. */
export interface DeviceCaps {
  /** `(pointer: coarse)` matches (touch-first device). */
  coarsePointer: boolean;
  /** Mobile-sized viewport. */
  smallScreen: boolean;
  /** Low-end hardware (few cores, little memory, or the adaptive FPS tier gave up). */
  lowEnd: boolean;
  /** OS `prefers-reduced-motion: reduce`, or the user's `a11y.reducedMotion` setting is "on". */
  reducedMotion: boolean;
}

const isMobile = (caps: DeviceCaps) => caps.coarsePointer || caps.smallScreen;

/**
 * Effective app interface style: classic on mobile, low-end devices and with reduced motion;
 * otherwise the user's choice, else the workspace default, else classic.
 */
export function resolveInterfaceStyle(
  user: InterfaceStyle | null | undefined,
  workspaceDefault: InterfaceStyle | null | undefined,
  caps: DeviceCaps,
): InterfaceStyle {
  if (isMobile(caps) || caps.lowEnd || caps.reducedMotion) return 'classic';
  return user ?? workspaceDefault ?? 'classic';
}

/**
 * Effective Leads Board skin: the user's choice, else the workspace default, else depth.
 * Neon becomes flat on mobile, low-end devices and with reduced motion; flat and depth stay as chosen.
 */
export function resolveBoardSkin(
  user: BoardSkin | null | undefined,
  workspaceDefault: BoardSkin | null | undefined,
  caps: DeviceCaps,
): BoardSkin {
  const skin = user ?? workspaceDefault ?? 'depth';
  if (skin === 'neon' && (isMobile(caps) || caps.lowEnd || caps.reducedMotion)) return 'flat';
  return skin;
}

/** Effective motion intensity: off with reduced motion, otherwise the user's choice (default full). */
export function resolveMotion(userMotion: MotionIntensity | null | undefined, caps: DeviceCaps): MotionIntensity {
  if (caps.reducedMotion) return 'off';
  return userMotion ?? 'full';
}

const CELEBRATIONS_BY_MOTION: Record<MotionIntensity, CelebrationIntensity> = { full: 'full', reduced: 'subtle', off: 'off' };

/**
 * Effective Board celebrations. `motion` is the RESOLVED motion (resolveMotion), so reduced motion
 * (motion "off") forces celebrations off, whatever the user chose. Otherwise the user's choice wins;
 * null follows motion: full -> full, reduced -> subtle.
 */
export function resolveCelebrations(userCelebrations: CelebrationIntensity | null | undefined, motion: MotionIntensity): CelebrationIntensity {
  if (motion === 'off') return 'off';
  return userCelebrations ?? CELEBRATIONS_BY_MOTION[motion];
}
