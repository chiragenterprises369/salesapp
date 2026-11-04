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
  bg: '#e9ebf0',
  surface: '#fbfbfc',
  'surface-2': '#ffffff',
  'surface-3': '#eef0f4',
  border: 'rgba(13, 15, 20, 0.09)',
  'border-strong': 'rgba(13, 15, 20, 0.17)',
  /** Form control edge: >= 3:1 on surface (WCAG 1.4.11). */
  'input-border': 'rgba(13, 15, 20, 0.17)',
  fg: '#0d0f14',
  'fg-secondary': '#434958',
  muted: '#5f6574',
  'muted-strong': '#374151',
  accent: '#d4ff3f',
  'accent-hover': '#c8f52a',
  'accent-active': '#b5e11d',
  'accent-fg': '#0d0f14',
  'accent-soft': 'rgba(110, 160, 0, 0.13)',
  'accent-soft-fg': '#496500',
  'accent-text': '#496500',
  ring: '#496500',
  overlay: 'rgba(13, 15, 20, 0.38)',
  skeleton: '#e1e4ea',
  success: '#4a7300',
  'success-text': '#4a7300',
  warning: '#9a5b00',
  'warning-text': '#9a5b00',
  danger: '#c4234f',
  'danger-hover': '#a5183e',
  'danger-fg': '#ffffff',
  'danger-text': '#c4234f',
  'status-blue-bg': 'rgba(0, 134, 155, 0.10)',
  'status-blue-fg': '#00869b',
  'status-blue-border': 'rgba(0, 134, 155, 0.25)',
  'status-green-bg': 'rgba(74, 115, 0, 0.10)',
  'status-green-fg': '#4a7300',
  'status-green-border': 'rgba(74, 115, 0, 0.25)',
  'status-amber-bg': 'rgba(154, 91, 0, 0.10)',
  'status-amber-fg': '#9a5b00',
  'status-amber-border': 'rgba(154, 91, 0, 0.25)',
  'status-grey-bg': 'rgba(89, 96, 116, 0.10)',
  'status-grey-fg': '#596074',
  'status-grey-border': 'rgba(89, 96, 116, 0.25)',
  'status-red-bg': 'rgba(196, 35, 79, 0.10)',
  'status-red-fg': '#c4234f',
  'status-red-border': 'rgba(196, 35, 79, 0.25)',
  'status-indigo-bg': 'rgba(29, 104, 196, 0.10)',
  'status-indigo-fg': '#1d68c4',
  'status-indigo-border': 'rgba(29, 104, 196, 0.25)',
  'chart-1': '#a6dc1a',
  'chart-2': '#12a9c4',
  'chart-3': '#a96400',
  'chart-4': '#cc2a5d',
  'chart-5': '#00875f',
  'chart-6': '#596074',
  'chart-grid': 'rgba(13, 15, 20, 0.09)',
  'chart-axis': '#5f6574',
  'elevation-1': '0 1px 2px rgba(13, 15, 20, 0.04), 0 6px 18px -10px rgba(13, 15, 20, 0.14)',
  'elevation-2': '0 1px 3px rgba(13, 15, 20, 0.08), 0 8px 20px -8px rgba(13, 15, 20, 0.16)',
  'elevation-3': '0 20px 44px -18px rgba(13, 15, 20, 0.35), 0 0 0 1px rgba(13, 15, 20, 0.09)',
  'elevation-drag': '0 20px 44px -18px rgba(13, 15, 20, 0.35), 0 0 0 1px rgba(13, 15, 20, 0.17)',
};

export const darkPalette: ThemePalette = {
  bg: '#050507',
  surface: '#111218',
  'surface-2': '#181922',
  'surface-3': '#1a1b24',
  border: 'rgba(255, 255, 255, 0.08)',
  'border-strong': 'rgba(255, 255, 255, 0.16)',
  'input-border': 'rgba(255, 255, 255, 0.16)',
  fg: '#f4f5f9',
  'fg-secondary': '#aab0c2',
  muted: '#858a9e',
  'muted-strong': '#9ca3af',
  accent: '#d4ff3f',
  'accent-hover': '#e2ff6e',
  'accent-active': '#c8f52a',
  'accent-fg': '#0b0d05',
  'accent-soft': 'rgba(212, 255, 63, 0.14)',
  'accent-soft-fg': '#d4ff3f',
  'accent-text': '#d4ff3f',
  ring: '#d4ff3f',
  overlay: 'rgba(0, 0, 0, 0.62)',
  skeleton: '#181922',
  success: '#d4ff3f',
  'success-text': '#d4ff3f',
  warning: '#ffbe4d',
  'warning-text': '#ffbe4d',
  danger: '#ff5c8a',
  'danger-hover': '#ff759d',
  'danger-fg': '#1a0710',
  'danger-text': '#ff5c8a',
  'status-blue-bg': 'rgba(62, 242, 255, 0.12)',
  'status-blue-fg': '#3ef2ff',
  'status-blue-border': 'rgba(62, 242, 255, 0.28)',
  'status-green-bg': 'rgba(212, 255, 63, 0.12)',
  'status-green-fg': '#d4ff3f',
  'status-green-border': 'rgba(212, 255, 63, 0.28)',
  'status-amber-bg': 'rgba(255, 190, 77, 0.12)',
  'status-amber-fg': '#ffbe4d',
  'status-amber-border': 'rgba(255, 190, 77, 0.28)',
  'status-grey-bg': 'rgba(138, 144, 168, 0.12)',
  'status-grey-fg': '#8a90a8',
  'status-grey-border': 'rgba(138, 144, 168, 0.28)',
  'status-red-bg': 'rgba(255, 92, 138, 0.12)',
  'status-red-fg': '#ff5c8a',
  'status-red-border': 'rgba(255, 92, 138, 0.28)',
  'status-indigo-bg': 'rgba(92, 184, 255, 0.12)',
  'status-indigo-fg': '#5cb8ff',
  'status-indigo-border': 'rgba(92, 184, 255, 0.28)',
  'chart-1': '#d4ff3f',
  'chart-2': '#3ef2ff',
  'chart-3': '#ffbe4d',
  'chart-4': '#ff5c8a',
  'chart-5': '#4dffc3',
  'chart-6': '#8a90a8',
  'chart-grid': 'rgba(255, 255, 255, 0.08)',
  'chart-axis': '#858a9e',
  'elevation-1': 'none',
  'elevation-2': '0 4px 12px rgba(0, 0, 0, 0.50)',
  'elevation-3': '0 18px 40px -16px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.16)',
  'elevation-drag': '0 18px 40px -16px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.25)',
};

export const palettes = { light: lightPalette, dark: darkPalette } as const;

export const radii = { sm: '8px', md: '10px', card: '18px', full: '9999px' } as const;

/**
 * Motion budget: purposeful and fast. Gate everything on the resolved motion intensity
 * (`<html data-motion="full|reduced|off">`, SPEC 28.2) and `useReducedMotion()`.
 * CSS: --duration-fast/--duration/--duration-slow, --duration-page(-exit), --duration-fade, --easing(-glide|-exit).
 */
export const motion = {
  fast: 150,
  base: 250,
  slow: 350,
  /** Page transition, arriving page. */
  page: 450,
  /** Page transition, leaving page. */
  pageExit: 200,
  /** Fade used instead of movement when motion intensity is "reduced". */
  fade: 200,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  /** Decelerating glide for things arriving (page enter, panels settling). */
  easingGlide: 'cubic-bezier(0.22, 1, 0.36, 1)',
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
      'glass-border': 'rgba(212, 255, 63, 0.35)',
      'glass-highlight': 'rgba(255, 255, 255, 0.95)',
      'glass-sheen': 'rgba(255, 255, 255, 0.60)',
      'depth-shadow-1': '0 1px 1px rgba(13, 15, 20, 0.04), 0 2px 8px rgba(90, 130, 0, 0.08)',
      'depth-shadow-2': '0 1px 2px rgba(13, 15, 20, 0.05), 0 8px 20px rgba(90, 130, 0, 0.10), 0 18px 44px rgba(18, 169, 196, 0.08)',
      'depth-shadow-3': '0 2px 4px rgba(13, 15, 20, 0.06), 0 14px 32px rgba(90, 130, 0, 0.14), 0 32px 64px rgba(18, 169, 196, 0.10)',
      'space-base': '#e9ebf0',
      'space-base-2': '#e1e4ea',
      'space-glow-1': 'rgba(212, 255, 63, 0.12)',
      'space-glow-2': 'rgba(18, 169, 196, 0.10)',
      'space-glow-3': 'rgba(255, 92, 138, 0.06)',
      'space-grid': 'rgba(90, 130, 0, 0)',
      'space-horizon': 'rgba(90, 130, 0, 0)',
      'space-vignette': 'rgba(13, 15, 20, 0)',
      'space-particle': 'rgba(90, 130, 0, 0)',
      'space-particle-2': 'rgba(18, 169, 196, 0)',
      'edge-glow': '#d4ff3f',
      'edge-glow-shadow': '0 0 0 transparent',
    },
    dark: {
      'glass-fill': 'rgba(17, 18, 24, 0.74)',
      'glass-panel': 'rgba(24, 25, 34, 0.88)',
      'glass-border': 'rgba(212, 255, 63, 0.35)',
      'glass-highlight': 'rgba(212, 255, 63, 0.12)',
      'glass-sheen': 'rgba(62, 242, 255, 0.08)',
      'depth-shadow-1': '0 1px 1px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.30)',
      'depth-shadow-2': '0 1px 2px rgba(0, 0, 0, 0.45), 0 8px 24px rgba(0, 0, 0, 0.45), 0 0 12px rgba(212, 255, 63, 0.20)',
      'depth-shadow-3': '0 2px 4px rgba(0, 0, 0, 0.50), 0 16px 36px rgba(0, 0, 0, 0.55), 0 0 12px rgba(212, 255, 63, 0.28)',
      'space-base': '#050507',
      'space-base-2': '#0a0b10',
      'space-glow-1': 'rgba(212, 255, 63, 0.18)',
      'space-glow-2': 'rgba(62, 242, 255, 0.08)',
      'space-glow-3': 'rgba(255, 92, 138, 0.08)',
      'space-grid': 'rgba(212, 255, 63, 0.08)',
      'space-horizon': 'rgba(212, 255, 63, 0.22)',
      'space-vignette': 'rgba(0, 0, 0, 0.45)',
      'space-particle': 'rgba(212, 255, 63, 0.70)',
      'space-particle-2': 'rgba(62, 242, 255, 0.60)',
      'edge-glow': '#d4ff3f',
      'edge-glow-shadow': '0 0 12px rgba(212, 255, 63, 0.35)',
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
