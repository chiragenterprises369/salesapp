/**
 * Interface style and motion intensity (SPEC 28.2, D-052, D-053). Pure, dependency-free.
 *
 * TODO(D-052): backend-core ships these names and pure resolvers in @vistar/shared (docs/REQUESTS.md #1).
 * After that merge, import the types and resolvers from '@vistar/shared' and delete the copies here.
 * The boot script (interface-boot.ts) mirrors resolveInterface(); keep the two in sync.
 */

/** User key `ui.interfaceStyle`; null follows the workspace default. */
export const INTERFACE_STYLES = ['classic', 'depth', 'neon'] as const;
export type InterfaceStyle = (typeof INTERFACE_STYLES)[number];

/** User key `ui.motionIntensity` (default full). */
export const MOTION_INTENSITIES = ['full', 'reduced', 'off'] as const;
export type MotionIntensity = (typeof MOTION_INTENSITIES)[number];

/** Workspace key `ui.defaultInterfaceStyle` default. */
export const DEFAULT_INTERFACE_STYLE: InterfaceStyle = 'classic';
export const DEFAULT_MOTION_INTENSITY: MotionIntensity = 'full';

/** Existing user key `a11y.reducedMotion`: system follows the OS, on always reduces, off ignores the OS. */
export type ReducedMotionPreference = 'system' | 'on' | 'off';

export type InterfacePanel = 'company' | 'employee' | 'super-admin' | 'other';

export const NARROW_SCREEN_QUERY = '(max-width: 767.98px)';
export const COARSE_POINTER_QUERY = '(pointer: coarse)';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
/** hardwareConcurrency or deviceMemory (GB) at or below this counts as a low-end device. */
export const LOW_END_LIMIT = 4;

export interface DeviceCapabilities {
  /** Viewport under 768 px. */
  narrowScreen: boolean;
  /** Primary pointer is coarse (touch). */
  coarsePointer: boolean;
  /** hardwareConcurrency <= 4 or deviceMemory <= 4. */
  lowEnd: boolean;
  /** OS prefers-reduced-motion. */
  prefersReducedMotion: boolean;
}

export const CAPABLE_DEVICE: DeviceCapabilities = { narrowScreen: false, coarsePointer: false, lowEnd: false, prefersReducedMotion: false };

export function isLowEnd(hardwareConcurrency: number | undefined, deviceMemory: number | undefined): boolean {
  return (!!hardwareConcurrency && hardwareConcurrency <= LOW_END_LIMIT) || (!!deviceMemory && deviceMemory <= LOW_END_LIMIT);
}

/** Why the effective style or motion differs from what was asked for, most important first. */
export type InterfaceFallbackReason = 'reduced-motion-setting' | 'reduced-motion-device' | 'narrow-screen' | 'coarse-pointer' | 'low-end' | 'panel';

export interface ResolveInterfaceInput {
  /** `ui.interfaceStyle`; null = follow the workspace default. */
  interfaceStyle: InterfaceStyle | null;
  /** `ui.defaultInterfaceStyle` of the workspace (classic when unknown). */
  defaultInterfaceStyle: InterfaceStyle | null;
  motionIntensity: MotionIntensity;
  reducedMotion: ReducedMotionPreference;
  device: DeviceCapabilities;
  panel: InterfacePanel;
}

export interface ResolvedInterface {
  /** What the person (or the workspace default) asked for. */
  requestedStyle: InterfaceStyle;
  /** What is painted: `<html data-interface-style>`. */
  style: InterfaceStyle;
  requestedMotion: MotionIntensity;
  /** What is painted: `<html data-motion>`. */
  motion: MotionIntensity;
  /** Why `style` or `motion` differ from the request (empty when they match). */
  reasons: InterfaceFallbackReason[];
}

export function isInterfaceStyle(v: unknown): v is InterfaceStyle {
  return typeof v === 'string' && (INTERFACE_STYLES as readonly string[]).includes(v);
}
export function isMotionIntensity(v: unknown): v is MotionIntensity {
  return typeof v === 'string' && (MOTION_INTENSITIES as readonly string[]).includes(v);
}

/** Styles a panel offers. The Employee panel offers Classic and Depth only (SPEC 28.2 page map). */
export function stylesForPanel(panel: InterfacePanel): readonly InterfaceStyle[] {
  return panel === 'employee' ? ['classic', 'depth'] : INTERFACE_STYLES;
}

export function panelForPath(pathname: string): InterfacePanel {
  if (pathname === '/me' || pathname.startsWith('/me/')) return 'employee';
  if (pathname === '/app' || pathname.startsWith('/app/')) return 'company';
  if (pathname === '/super-admin' || pathname.startsWith('/super-admin/')) return 'super-admin';
  return 'other';
}

/**
 * D-052 resolver rules:
 * - style = user choice, else workspace default, else classic; Neon becomes Depth in the Employee panel;
 * - narrow screen (< 768 px), coarse pointer, low-end device (<= 4 cores or <= 4 GB) and reduced motion
 *   (OS, unless a11y.reducedMotion = off; or a11y.reducedMotion = on) fall back to Classic;
 * - motion = user choice, capped at Reduced by the same device conditions and OS reduced motion,
 *   and Off when a11y.reducedMotion = on.
 */
export function resolveInterface(input: ResolveInterfaceInput): ResolvedInterface {
  const { device } = input;
  const requestedStyle = input.interfaceStyle ?? input.defaultInterfaceStyle ?? DEFAULT_INTERFACE_STYLE;
  const requestedMotion = input.motionIntensity;
  const reasons: InterfaceFallbackReason[] = [];

  const settingReduces = input.reducedMotion === 'on';
  const deviceReduces = input.reducedMotion === 'system' && device.prefersReducedMotion;
  if (settingReduces) reasons.push('reduced-motion-setting');
  if (deviceReduces) reasons.push('reduced-motion-device');
  if (device.narrowScreen) reasons.push('narrow-screen');
  if (device.coarsePointer) reasons.push('coarse-pointer');
  if (device.lowEnd) reasons.push('low-end');

  let style = requestedStyle;
  if (style === 'neon' && !stylesForPanel(input.panel).includes('neon')) {
    style = 'depth';
    reasons.push('panel');
  }
  if (reasons.some((r) => r !== 'panel')) style = 'classic';

  let motion = requestedMotion;
  if (settingReduces) motion = 'off';
  else if (motion === 'full' && (deviceReduces || device.narrowScreen || device.coarsePointer || device.lowEnd)) motion = 'reduced';

  const changed = style !== requestedStyle || motion !== requestedMotion;
  return { requestedStyle, style, requestedMotion, motion, reasons: changed ? reasons : [] };
}

export const INTERFACE_STYLE_LABEL: Record<InterfaceStyle, string> = { classic: 'Classic', depth: 'Depth', neon: 'Neon Space' };
export const MOTION_INTENSITY_LABEL: Record<MotionIntensity, string> = { full: 'Full', reduced: 'Reduced', off: 'Off' };

const REASON_TEXT: Record<InterfaceFallbackReason, string> = {
  'reduced-motion-setting': 'Reduce motion is on in your preferences',
  'reduced-motion-device': 'this device asks for reduced motion',
  'narrow-screen': 'the screen is narrower than 768 px',
  'coarse-pointer': 'this is a touch screen',
  'low-end': 'this device has 4 or fewer processor cores or 4 GB of memory or less',
  panel: 'Neon Space is not available in the employee app',
};

/**
 * One sentence explaining an automatic override, e.g. "Classic is used on this device because reduced
 * motion is on." Null when nothing is overridden.
 */
export function describeOverride(r: ResolvedInterface): string | null {
  if (!r.reasons.length) return null;
  const why = REASON_TEXT[r.reasons[0]!];
  if (r.style !== r.requestedStyle) {
    const where = r.reasons[0] === 'panel' ? 'here' : 'on this device';
    return `${INTERFACE_STYLE_LABEL[r.style]} is used ${where} because ${why}.`;
  }
  return `${MOTION_INTENSITY_LABEL[r.motion]} motion is used on this device because ${why}.`;
}
