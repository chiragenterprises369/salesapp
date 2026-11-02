import type { EmployeeStatus } from '../enums.js';

/**
 * Design tokens: single source of truth for both themes.
 * apps/web/styles/tokens.css is GENERATED from this file (`pnpm --filter @vistar/shared tokens`).
 * Use these JS values where CSS variables are unavailable: Three.js scenes, email templates, canvas.
 *
 * Contrast notes (WCAG AA):
 * - `muted` on `surface` passes AA in both themes. On light `bg` (#F6F7F9) `muted` is 4.44:1,
 *   so small muted text placed directly on `bg` must use `muted-strong`.
 * - Text on `accent` fills uses `accent-fg` (6.3:1). Accent-coloured text uses `accent-text`.
 */
export const TOKEN_NAMES = [
  'bg',
  'surface',
  'surface-2',
  'surface-3',
  'border',
  'border-strong',
  'input-border',
  'fg',
  'fg-secondary',
  'muted',
  'muted-strong',
  'accent',
  'accent-hover',
  'accent-active',
  'accent-fg',
  'accent-soft',
  'accent-soft-fg',
  'accent-text',
  'ring',
  'overlay',
  'skeleton',
  'success',
  'success-text',
  'warning',
  'warning-text',
  'danger',
  'danger-hover',
  'danger-fg',
  'danger-text',
  'status-blue-bg',
  'status-blue-fg',
  'status-blue-border',
  'status-green-bg',
  'status-green-fg',
  'status-green-border',
  'status-amber-bg',
  'status-amber-fg',
  'status-amber-border',
  'status-grey-bg',
  'status-grey-fg',
  'status-grey-border',
  'status-red-bg',
  'status-red-fg',
  'status-red-border',
  'status-indigo-bg',
  'status-indigo-fg',
  'status-indigo-border',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
  'chart-grid',
  'chart-axis',
  'elevation-1',
  'elevation-2',
  'elevation-3',
  'elevation-drag',
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
export type ThemePalette = Record<TokenName, string>;

export const lightPalette: ThemePalette = {
  bg: '#F6F7F9',
  surface: '#FFFFFF',
  'surface-2': '#F8FAFC',
  'surface-3': '#F1F5F9',
  border: '#E5E7EB',
  'border-strong': '#D1D5DB',
  /** Form control edge: >= 3:1 on surface (WCAG 1.4.11). */
  'input-border': '#868FA0',
  fg: '#0F172A',
  'fg-secondary': '#334155',
  muted: '#64748B',
  'muted-strong': '#56657A',
  accent: '#4F46E5',
  'accent-hover': '#4338CA',
  'accent-active': '#3730A3',
  'accent-fg': '#FFFFFF',
  'accent-soft': '#EEF2FF',
  'accent-soft-fg': '#4338CA',
  'accent-text': '#4F46E5',
  ring: '#4F46E5',
  overlay: 'rgba(15, 23, 42, 0.40)',
  skeleton: '#EEF0F3',
  success: '#059669',
  'success-text': '#047857',
  warning: '#D97706',
  'warning-text': '#B45309',
  danger: '#DC2626',
  'danger-hover': '#B91C1C',
  'danger-fg': '#FFFFFF',
  'danger-text': '#B91C1C',
  'status-blue-bg': '#EFF6FF',
  'status-blue-fg': '#1D4ED8',
  'status-blue-border': '#BFDBFE',
  'status-green-bg': '#ECFDF5',
  'status-green-fg': '#047857',
  'status-green-border': '#A7F3D0',
  'status-amber-bg': '#FFFBEB',
  'status-amber-fg': '#B45309',
  'status-amber-border': '#FDE68A',
  'status-grey-bg': '#F1F5F9',
  'status-grey-fg': '#475569',
  'status-grey-border': '#E2E8F0',
  'status-red-bg': '#FEF2F2',
  'status-red-fg': '#B91C1C',
  'status-red-border': '#FECACA',
  'status-indigo-bg': '#EEF2FF',
  'status-indigo-fg': '#4338CA',
  'status-indigo-border': '#C7D2FE',
  'chart-1': '#4F46E5',
  'chart-2': '#0284C7',
  'chart-3': '#059669',
  'chart-4': '#D97706',
  'chart-5': '#E11D48',
  'chart-6': '#64748B',
  'chart-grid': '#E5E7EB',
  'chart-axis': '#64748B',
  'elevation-1': '0 1px 2px rgba(15, 23, 42, 0.06)',
  'elevation-2': '0 1px 3px rgba(15, 23, 42, 0.08), 0 4px 12px rgba(15, 23, 42, 0.06)',
  'elevation-3': '0 2px 6px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.10)',
  'elevation-drag': '0 4px 10px rgba(15, 23, 42, 0.08), 0 18px 40px rgba(15, 23, 42, 0.18)',
};

export const darkPalette: ThemePalette = {
  bg: '#0F1115',
  surface: '#171A21',
  'surface-2': '#1C2029',
  'surface-3': '#222733',
  border: '#262A33',
  'border-strong': '#343A46',
  'input-border': '#626B7C',
  fg: '#E8ECF6',
  'fg-secondary': '#C3CADB',
  muted: '#8B96B3',
  'muted-strong': '#9AA4BF',
  accent: '#4F46E5',
  'accent-hover': '#5850EC',
  'accent-active': '#4338CA',
  'accent-fg': '#FFFFFF',
  'accent-soft': '#23224A',
  'accent-soft-fg': '#C7D2FE',
  'accent-text': '#818CF8',
  ring: '#818CF8',
  overlay: 'rgba(0, 0, 0, 0.60)',
  skeleton: '#1F232C',
  success: '#34D399',
  'success-text': '#6EE7B7',
  warning: '#FBBF24',
  'warning-text': '#FCD34D',
  danger: '#DC2626',
  'danger-hover': '#B91C1C',
  'danger-fg': '#FFFFFF',
  'danger-text': '#FCA5A5',
  'status-blue-bg': '#172338',
  'status-blue-fg': '#93C5FD',
  'status-blue-border': '#1E3A5F',
  'status-green-bg': '#11261D',
  'status-green-fg': '#6EE7B7',
  'status-green-border': '#14532D',
  'status-amber-bg': '#2A2112',
  'status-amber-fg': '#FCD34D',
  'status-amber-border': '#713F12',
  'status-grey-bg': '#20242C',
  'status-grey-fg': '#A7B0C2',
  'status-grey-border': '#2F3541',
  'status-red-bg': '#2C1618',
  'status-red-fg': '#FCA5A5',
  'status-red-border': '#7F1D1D',
  'status-indigo-bg': '#23224A',
  'status-indigo-fg': '#C7D2FE',
  'status-indigo-border': '#3730A3',
  'chart-1': '#818CF8',
  'chart-2': '#38BDF8',
  'chart-3': '#34D399',
  'chart-4': '#FBBF24',
  'chart-5': '#FB7185',
  'chart-6': '#94A3B8',
  'chart-grid': '#262A33',
  'chart-axis': '#8B96B3',
  'elevation-1': '0 1px 2px rgba(0, 0, 0, 0.40)',
  'elevation-2': '0 1px 3px rgba(0, 0, 0, 0.50), 0 4px 12px rgba(0, 0, 0, 0.35)',
  'elevation-3': '0 2px 6px rgba(0, 0, 0, 0.40), 0 8px 24px rgba(0, 0, 0, 0.50)',
  'elevation-drag': '0 4px 10px rgba(0, 0, 0, 0.40), 0 18px 40px rgba(0, 0, 0, 0.60)',
};

export const palettes = { light: lightPalette, dark: darkPalette } as const;

export const radii = { sm: '6px', md: '8px', card: '12px', full: '9999px' } as const;

/**
 * Motion budget: purposeful and fast. Gate everything on the resolved motion intensity
 * (`<html data-motion="full|reduced|off">`, SPEC 28.2) and `useReducedMotion()`.
 * CSS: --duration-fast/--duration/--duration-slow, --duration-page(-exit), --duration-fade, --easing(-glide|-exit).
 */
export const motion = {
  fast: 150,
  base: 200,
  slow: 250,
  /** Page transition, arriving page. With `pageExit` the whole move stays under 300 ms. */
  page: 260,
  /** Page transition, leaving page (runs at the same time as `page`). */
  pageExit: 140,
  /** Fade used instead of movement when motion intensity is "reduced". */
  fade: 150,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
  /** Decelerating glide for things arriving (page enter, panels settling). */
  easingGlide: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** Accelerating exit for things leaving. */
  easingExit: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

/**
 * Spring presets, one physics set for both libraries: `motion` takes { stiffness, damping, mass },
 * react-spring takes { tension, friction, mass } (tension = stiffness, friction = damping).
 * Use `motionSpring(name)` / `reactSpringConfig(name)`; do not invent per-page springs.
 */
export const springs = {
  /** Panels, popovers and cards settling. About 220 ms, no visible overshoot (damping ratio 0.92). */
  settle: { stiffness: 380, damping: 36, mass: 1 },
  /** Hover lift and press feedback. Snappy, about 2% overshoot (ratio 0.78). */
  lift: { stiffness: 520, damping: 32, mass: 0.8 },
  /** Pointer parallax and tilt follow. Soft, trails the pointer (ratio 1.05). */
  follow: { stiffness: 90, damping: 20, mass: 1 },
  /** Count-ups, gauges and progress rings (ratio 1.1). */
  gauge: { stiffness: 140, damping: 26, mass: 1 },
} as const;
export type SpringName = keyof typeof springs;

/** Spring transition for `motion` (`transition={motionSpring('settle')}`). */
export function motionSpring(name: SpringName) {
  return { type: 'spring' as const, ...springs[name] };
}

/** Spring config for `@react-spring/web` (`useSpring({ config: reactSpringConfig('follow') })`). */
export function reactSpringConfig(name: SpringName) {
  const s = springs[name];
  return { tension: s.stiffness, friction: s.damping, mass: s.mass };
}

/**
 * Depth, glass and glow limits for the opt-in Depth and Neon Space styles (D-053, SPEC 28.1/28.2).
 * Values are HARD CAPS: never exceed them on any page. Distances in px, angles in degrees.
 * CSS: --glass-blur, --blur-max, --glow-blur-max, --glow-alpha-max, --parallax-*, --tilt-max,
 * --lift-y, --page-enter-shift, --page-enter-scale, --page-exit-scale.
 */
export const spaceTokens = {
  /** backdrop-filter blur for glass chrome (sidebar, top bar) and large wall screens. Never per card. */
  glassBlur: 14,
  /** Max blur radius anywhere (backdrop-filter or filter). */
  blurMax: 20,
  /** Neon glow caps: blur radius and alpha of the glow colour. Keeps text on and near edges AA. */
  glowBlurMax: 12,
  glowAlphaMax: 0.35,
  /** Pointer parallax travel at the viewport edge, by layer depth. 0 under reduced/off motion. */
  parallax: { far: 4, mid: 8, near: 14, sheen: 24 },
  /** Max pointer tilt of wall-screen panels. */
  tiltMax: 4,
  /** Hover lift distance. */
  lift: 2,
  /** Page transition geometry: arriving page rises `enterShift` px and scales from `enterScale`. */
  page: { enterShift: 10, enterScale: 0.985, exitScale: 1.015 },
  /** Shell background particles (dark theme only). The 28.1 board layer has its own cap (300). */
  particles: { depth: 36, neon: 64 },
  /** Ambient effects drop a tier when the frame rate stays under this for `fpsWindowMs`. */
  fpsFloor: 45,
  fpsWindowMs: 2000,
} as const;

/** CSS variables of the shell space layer, glass surfaces and depth shadows (per style and theme). */
export const SPACE_TOKEN_NAMES = [
  'glass-fill',
  'glass-panel',
  'glass-border',
  'glass-highlight',
  'glass-sheen',
  'depth-shadow-1',
  'depth-shadow-2',
  'depth-shadow-3',
  'space-base',
  'space-base-2',
  'space-glow-1',
  'space-glow-2',
  'space-glow-3',
  'space-grid',
  'space-horizon',
  'space-vignette',
  'space-particle',
  'space-particle-2',
  'edge-glow',
  'edge-glow-shadow',
] as const;
export type SpaceTokenName = (typeof SPACE_TOKEN_NAMES)[number];
export type SpacePalette = Record<SpaceTokenName, string>;

/**
 * Space palettes per style and theme. Depth: frosted glass over a soft wash (light) or a dark gradient
 * with a faint perspective grid and sparse particles (dark). Neon Space: saturated edges with capped
 * glow in dark; in light it is the "Aurora" variant (pastel glass, coloured edges and shadows, no glow).
 * Contrast: the rendered background stays within L >= 0.80 (light) and L <= 0.03 (dark), so
 * `muted-strong`, `fg-secondary` and `fg` keep AA on it; glass chrome swaps `muted` for `muted-strong`.
 */
export const spacePalettes: Record<'depth' | 'neon', Record<'light' | 'dark', SpacePalette>> = {
  depth: {
    light: {
      'glass-fill': 'rgba(255, 255, 255, 0.74)',
      'glass-panel': 'rgba(255, 255, 255, 0.88)',
      'glass-border': 'rgba(15, 23, 42, 0.08)',
      'glass-highlight': 'rgba(255, 255, 255, 0.90)',
      'glass-sheen': 'rgba(255, 255, 255, 0.55)',
      'depth-shadow-1': '0 1px 1px rgba(15, 23, 42, 0.04), 0 2px 6px rgba(15, 23, 42, 0.05)',
      'depth-shadow-2': '0 1px 2px rgba(15, 23, 42, 0.05), 0 6px 16px rgba(15, 23, 42, 0.07), 0 16px 40px rgba(79, 70, 229, 0.06)',
      'depth-shadow-3': '0 2px 4px rgba(15, 23, 42, 0.06), 0 12px 28px rgba(15, 23, 42, 0.10), 0 32px 64px rgba(79, 70, 229, 0.10)',
      'space-base': '#F7F8FA',
      'space-base-2': '#F2F4F8',
      'space-glow-1': 'rgba(99, 102, 241, 0.07)',
      'space-glow-2': 'rgba(14, 165, 233, 0.05)',
      'space-glow-3': 'rgba(16, 185, 129, 0.04)',
      'space-grid': 'rgba(79, 70, 229, 0)',
      'space-horizon': 'rgba(79, 70, 229, 0)',
      'space-vignette': 'rgba(15, 23, 42, 0)',
      'space-particle': 'rgba(79, 70, 229, 0)',
      'space-particle-2': 'rgba(14, 165, 233, 0)',
      'edge-glow': '#6366F1',
      'edge-glow-shadow': '0 0 0 transparent',
    },
    dark: {
      'glass-fill': 'rgba(23, 26, 33, 0.72)',
      'glass-panel': 'rgba(23, 26, 33, 0.88)',
      'glass-border': 'rgba(255, 255, 255, 0.07)',
      'glass-highlight': 'rgba(255, 255, 255, 0.06)',
      'glass-sheen': 'rgba(165, 180, 252, 0.08)',
      'depth-shadow-1': '0 1px 1px rgba(0, 0, 0, 0.30), 0 2px 8px rgba(0, 0, 0, 0.25)',
      'depth-shadow-2': '0 1px 2px rgba(0, 0, 0, 0.40), 0 8px 20px rgba(0, 0, 0, 0.35), 0 20px 48px rgba(8, 10, 30, 0.45)',
      'depth-shadow-3': '0 2px 4px rgba(0, 0, 0, 0.45), 0 14px 32px rgba(0, 0, 0, 0.45), 0 36px 72px rgba(8, 10, 30, 0.55)',
      'space-base': '#11131B',
      'space-base-2': '#0C0E13',
      'space-glow-1': 'rgba(99, 102, 241, 0.12)',
      'space-glow-2': 'rgba(56, 189, 248, 0.05)',
      'space-glow-3': 'rgba(139, 92, 246, 0.05)',
      'space-grid': 'rgba(129, 140, 248, 0.09)',
      'space-horizon': 'rgba(129, 140, 248, 0.14)',
      'space-vignette': 'rgba(0, 0, 0, 0.35)',
      'space-particle': 'rgba(199, 210, 254, 0.55)',
      'space-particle-2': 'rgba(125, 211, 252, 0.40)',
      'edge-glow': '#818CF8',
      'edge-glow-shadow': '0 0 0 transparent',
    },
  },
  neon: {
    light: {
      'glass-fill': 'rgba(255, 255, 255, 0.72)',
      'glass-panel': 'rgba(255, 255, 255, 0.86)',
      'glass-border': 'rgba(99, 102, 241, 0.26)',
      'glass-highlight': 'rgba(255, 255, 255, 0.95)',
      'glass-sheen': 'rgba(255, 255, 255, 0.60)',
      'depth-shadow-1': '0 1px 1px rgba(15, 23, 42, 0.04), 0 2px 8px rgba(99, 102, 241, 0.08)',
      'depth-shadow-2': '0 1px 2px rgba(15, 23, 42, 0.05), 0 8px 20px rgba(99, 102, 241, 0.10), 0 18px 44px rgba(14, 165, 233, 0.08)',
      'depth-shadow-3': '0 2px 4px rgba(15, 23, 42, 0.06), 0 14px 32px rgba(99, 102, 241, 0.14), 0 32px 64px rgba(14, 165, 233, 0.10)',
      'space-base': '#F8F8FD',
      'space-base-2': '#F3F5FC',
      'space-glow-1': 'rgba(129, 140, 248, 0.10)',
      'space-glow-2': 'rgba(34, 211, 238, 0.10)',
      'space-glow-3': 'rgba(244, 114, 182, 0.06)',
      'space-grid': 'rgba(99, 102, 241, 0)',
      'space-horizon': 'rgba(99, 102, 241, 0)',
      'space-vignette': 'rgba(15, 23, 42, 0)',
      'space-particle': 'rgba(99, 102, 241, 0)',
      'space-particle-2': 'rgba(34, 211, 238, 0)',
      'edge-glow': '#6366F1',
      'edge-glow-shadow': '0 0 0 transparent',
    },
    dark: {
      'glass-fill': 'rgba(13, 15, 26, 0.74)',
      'glass-panel': 'rgba(16, 18, 30, 0.88)',
      'glass-border': 'rgba(129, 140, 248, 0.30)',
      'glass-highlight': 'rgba(165, 243, 252, 0.10)',
      'glass-sheen': 'rgba(103, 232, 249, 0.08)',
      'depth-shadow-1': '0 1px 1px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.30)',
      'depth-shadow-2': '0 1px 2px rgba(0, 0, 0, 0.45), 0 8px 24px rgba(0, 0, 0, 0.45), 0 0 12px rgba(99, 102, 241, 0.16)',
      'depth-shadow-3': '0 2px 4px rgba(0, 0, 0, 0.50), 0 16px 36px rgba(0, 0, 0, 0.55), 0 0 12px rgba(99, 102, 241, 0.22)',
      'space-base': '#0B0D17',
      'space-base-2': '#07080F',
      'space-glow-1': 'rgba(99, 102, 241, 0.20)',
      'space-glow-2': 'rgba(34, 211, 238, 0.06)',
      'space-glow-3': 'rgba(168, 85, 247, 0.09)',
      'space-grid': 'rgba(103, 232, 249, 0.10)',
      'space-horizon': 'rgba(103, 232, 249, 0.24)',
      'space-vignette': 'rgba(0, 0, 0, 0.45)',
      'space-particle': 'rgba(165, 243, 252, 0.70)',
      'space-particle-2': 'rgba(199, 210, 254, 0.60)',
      'edge-glow': '#67E8F9',
      'edge-glow-shadow': '0 0 10px rgba(103, 232, 249, 0.30)',
    },
  },
};

export const CHIP_TONES = ['neutral', 'indigo', 'blue', 'green', 'amber', 'grey', 'red'] as const;
export type ChipTone = (typeof CHIP_TONES)[number];

/** Status colour rule from the design system. */
export const EMPLOYEE_STATUS_TONE: Record<EmployeeStatus, ChipTone> = {
  on_call: 'blue',
  idle: 'green',
  busy: 'amber',
  away: 'grey',
  offline: 'grey',
};

export const EMPLOYEE_STATUS_LABEL: Record<EmployeeStatus, string> = {
  on_call: 'On call',
  idle: 'Available',
  busy: 'Busy',
  away: 'On break',
  offline: 'Offline',
};

/** Fixed chart series order; use `var(--chart-N)` in CSS or palettes[theme]['chart-N'] in JS. */
export const CHART_SERIES = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'] as const;

/** Default soft tint per stage key for Board columns (column bg = status-<tone>-bg, dot = status-<tone>-fg). */
export const DEFAULT_STAGE_TONES: Record<string, ChipTone> = {
  new: 'grey',
  contacted: 'blue',
  interested: 'amber',
  quote_sent: 'indigo',
  won: 'green',
  lost: 'red',
};

/** Tone for a stage: default by key, else by stage type, else neutral. */
export function stageTone(stage: { key: string; type?: 'open' | 'won' | 'lost' }): ChipTone {
  return DEFAULT_STAGE_TONES[stage.key] ?? (stage.type === 'won' ? 'green' : stage.type === 'lost' ? 'red' : 'neutral');
}
