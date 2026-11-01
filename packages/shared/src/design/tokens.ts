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

/** Motion budget: purposeful and fast. Always gate on prefers-reduced-motion. */
export const motion = {
  fast: 150,
  base: 200,
  slow: 250,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

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
