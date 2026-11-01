import { EMPLOYEE_STATUS_TONE, palettes, type ChipTone, type EmployeeStatus, type ResolvedTheme, type ThemePalette } from '@vistar/shared';
import * as THREE from 'three';

/**
 * Scene colours and light levels per theme, derived ONLY from `palettes[theme]`.
 * Light = daylight office (cool key light, bright floor). Dark = evening office (dim ambient,
 * warm lamps, glowing accent monitors).
 */

export const SURFACES = [
  'floor',
  'floorCalling',
  'floorLounge',
  'floorCabin',
  'floorHub',
  'slab',
  'wall',
  'wallLow',
  'glass',
  'desk',
  'deskEdge',
  'divider',
  'chair',
  'monitor',
  'screen',
  'plantPot',
  'plant',
  'sofa',
  'rug',
  'shelf',
  'counter',
  'appliance',
  'hubBase',
  'hubRing',
  'hubTop',
  'parcel',
  'lampShade',
  'lampStem',
  'phone',
  'label',
  'blob',
  'select',
  'ring',
] as const;
export type Surface = (typeof SURFACES)[number];

/** Surfaces with an emissive glow. */
export const EMISSIVE: readonly Surface[] = ['screen', 'hubRing', 'hubTop', 'parcel', 'lampShade'];

export interface Look {
  color: Record<Surface, THREE.Color>;
  emissive: Record<Surface, THREE.Color>;
  emissiveIntensity: Record<Surface, number>;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  sun: THREE.Color;
  sunIntensity: number;
  lamp: THREE.Color;
  lampIntensity: number;
  glassOpacity: number;
  status: Record<EmployeeStatus, THREE.Color>;
}

/** CSS colours for canvas-drawn labels (tags, bubbles, popups). */
export interface LabelPalette {
  surface: string;
  border: string;
  fg: string;
  muted: string;
  font: string;
  tone: Record<ChipTone, { bg: string; fg: string; border: string }>;
  status: Record<EmployeeStatus, string>;
}

type SurfaceTokens = Record<Surface, keyof ThemePalette>;

const LIGHT_SURFACES: SurfaceTokens = {
  floor: 'surface-2',
  floorCalling: 'status-blue-bg',
  floorLounge: 'status-green-bg',
  floorCabin: 'status-indigo-bg',
  floorHub: 'accent-soft',
  slab: 'border-strong',
  wall: 'surface',
  wallLow: 'border',
  glass: 'status-blue-border',
  desk: 'surface',
  deskEdge: 'border-strong',
  divider: 'border',
  chair: 'muted',
  monitor: 'fg-secondary',
  screen: 'accent-soft',
  plantPot: 'border-strong',
  plant: 'success',
  sofa: 'status-indigo-border',
  rug: 'surface-3',
  shelf: 'border-strong',
  counter: 'surface',
  appliance: 'fg-secondary',
  hubBase: 'accent-soft',
  hubRing: 'accent',
  hubTop: 'surface',
  parcel: 'accent',
  lampShade: 'border',
  lampStem: 'border-strong',
  phone: 'fg',
  label: 'muted',
  blob: 'fg',
  select: 'accent',
  ring: 'status-blue-fg',
};

const DARK_SURFACES: SurfaceTokens = {
  floor: 'surface-2',
  floorCalling: 'status-blue-bg',
  floorLounge: 'status-green-bg',
  floorCabin: 'status-indigo-bg',
  floorHub: 'accent-soft',
  slab: 'border-strong',
  wall: 'surface-3',
  wallLow: 'border-strong',
  glass: 'status-blue-border',
  desk: 'surface-3',
  deskEdge: 'border-strong',
  divider: 'border',
  chair: 'border-strong',
  monitor: 'bg',
  screen: 'accent',
  plantPot: 'border-strong',
  plant: 'success',
  sofa: 'status-indigo-border',
  rug: 'surface',
  shelf: 'border-strong',
  counter: 'surface-3',
  appliance: 'border-strong',
  hubBase: 'accent-soft',
  hubRing: 'accent-text',
  hubTop: 'surface-3',
  parcel: 'accent-text',
  lampShade: 'warning',
  lampStem: 'border-strong',
  phone: 'fg',
  label: 'muted',
  blob: 'bg',
  select: 'accent-text',
  ring: 'status-blue-fg',
};

const EMISSIVE_TOKENS: Record<ResolvedTheme, Partial<Record<Surface, [keyof ThemePalette, number]>>> = {
  light: {
    screen: ['accent', 0.12],
    hubRing: ['accent', 0.35],
    hubTop: ['accent-soft', 0.1],
    parcel: ['accent', 0.35],
    lampShade: ['warning', 0],
  },
  dark: {
    screen: ['accent', 1.1],
    hubRing: ['accent-text', 1.0],
    hubTop: ['accent', 0.35],
    parcel: ['accent-text', 0.9],
    lampShade: ['warning', 1.0],
  },
};

const c = (hex: string) => new THREE.Color(hex);

export function sceneLook(theme: ResolvedTheme): Look {
  const p = palettes[theme];
  const tokens = theme === 'dark' ? DARK_SURFACES : LIGHT_SURFACES;
  const color = {} as Record<Surface, THREE.Color>;
  const emissive = {} as Record<Surface, THREE.Color>;
  const emissiveIntensity = {} as Record<Surface, number>;
  for (const s of SURFACES) {
    color[s] = c(p[tokens[s]]);
    const e = EMISSIVE_TOKENS[theme][s];
    emissive[s] = e ? c(p[e[0]]) : c('#000000');
    emissiveIntensity[s] = e ? e[1] : 0;
  }
  const status = {} as Record<EmployeeStatus, THREE.Color>;
  for (const [s, tone] of Object.entries(EMPLOYEE_STATUS_TONE) as [EmployeeStatus, ChipTone][]) {
    status[s] = c(p[`status-${tone}-fg` as keyof ThemePalette]);
  }
  const dark = theme === 'dark';
  return {
    color,
    emissive,
    emissiveIntensity,
    // Evening: cool moonlit ambient from the indigo scale, warm lamps do the rest.
    hemiSky: c(dark ? p['status-indigo-fg'] : p.surface),
    hemiGround: c(dark ? p.surface : p.border),
    hemiIntensity: dark ? 0.85 : 2.0,
    sun: c(dark ? p['status-indigo-fg'] : p['surface-2']),
    sunIntensity: dark ? 0.7 : 2.2,
    lamp: c(p['status-amber-fg']),
    lampIntensity: dark ? 7 : 0,
    glassOpacity: dark ? 0.4 : 0.32,
    status,
  };
}

/** Lerp every colour and number of `a` towards `b` into `out`. */
export function mixLook(a: Look, b: Look, t: number, out: Look): Look {
  for (const s of SURFACES) {
    out.color[s].lerpColors(a.color[s], b.color[s], t);
    out.emissive[s].lerpColors(a.emissive[s], b.emissive[s], t);
    out.emissiveIntensity[s] = a.emissiveIntensity[s] + (b.emissiveIntensity[s] - a.emissiveIntensity[s]) * t;
  }
  for (const s of Object.keys(out.status) as EmployeeStatus[]) out.status[s].lerpColors(a.status[s], b.status[s], t);
  out.hemiSky.lerpColors(a.hemiSky, b.hemiSky, t);
  out.hemiGround.lerpColors(a.hemiGround, b.hemiGround, t);
  out.sun.lerpColors(a.sun, b.sun, t);
  out.lamp.lerpColors(a.lamp, b.lamp, t);
  out.hemiIntensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t;
  out.sunIntensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t;
  out.lampIntensity = a.lampIntensity + (b.lampIntensity - a.lampIntensity) * t;
  out.glassOpacity = a.glassOpacity + (b.glassOpacity - a.glassOpacity) * t;
  return out;
}

export function labelPalette(theme: ResolvedTheme): LabelPalette {
  const p = palettes[theme];
  const tone = (t: ChipTone) =>
    t === 'neutral'
      ? { bg: p['surface-2'], fg: p['fg-secondary'], border: p.border }
      : { bg: p[`status-${t}-bg` as keyof ThemePalette], fg: p[`status-${t}-fg` as keyof ThemePalette], border: p[`status-${t}-border` as keyof ThemePalette] };
  const font =
    typeof document !== 'undefined' ? getComputedStyle(document.body).fontFamily || 'ui-sans-serif, system-ui, sans-serif' : 'ui-sans-serif, system-ui, sans-serif';
  const status = {} as Record<EmployeeStatus, string>;
  for (const [s, t] of Object.entries(EMPLOYEE_STATUS_TONE) as [EmployeeStatus, ChipTone][]) status[s] = p[`status-${t}-fg` as keyof ThemePalette];
  return {
    surface: p.surface,
    border: p['border-strong'],
    fg: p.fg,
    muted: p['muted-strong'],
    font,
    tone: {
      neutral: tone('neutral'),
      indigo: tone('indigo'),
      blue: tone('blue'),
      green: tone('green'),
      amber: tone('amber'),
      grey: tone('grey'),
      red: tone('red'),
    },
    status,
  };
}
