import { EMPLOYEE_STATUS_TONE, palettes, type ChipTone, type EmployeeStatus, type ResolvedTheme, type ThemePalette } from '@vistar/shared';
import * as THREE from 'three';

/**
 * Scene lighting per theme. The office itself is baked (Day lightmap + AO, SPEC 12.1 item 2), so
 * the look mostly drives: lightmap level and tint, emissive levels (screens, hub ring, reception
 * edge, lamps), the realtime key/fill light for characters and instanced props, and status colours.
 * UI accents (status rings, selection) come from `palettes[theme]`; the office art colours are
 * authored in the Blender build (scripts/team-floor/blender/props.py) and listed in ART for the
 * procedural fallback.
 *
 * Phase A: Light = the Day bake. Dark = the same bake dimmed and cooled with brighter emissives and
 * warm light pools (interim until the Evening bake lands in Phase B).
 */

export interface Look {
  lightmap: number;
  tint: THREE.Color;
  ao: number;
  screen: THREE.Color;
  screenLevel: number;
  hub: THREE.Color;
  hubLevel: number;
  reception: THREE.Color;
  receptionLevel: number;
  lamp: THREE.Color;
  lampLevel: number;
  windowColor: THREE.Color;
  glassOpacity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  sun: THREE.Color;
  sunIntensity: number;
  /** Soft fill from the camera side so faces towards the viewer are not in shadow. */
  fill: THREE.Color;
  fillIntensity: number;
  rim: THREE.Color;
  rimStrength: number;
  outline: THREE.Color;
  shadowOpacity: number;
  /** Additive warm light pools on the floor (dark interim). */
  poolLevel: number;
  pool: THREE.Color;
  contactShadow: number;
  status: Record<EmployeeStatus, THREE.Color>;
  accent: THREE.Color;
}

/** Authored asset colours (mirror of the Blender palette) for the procedural fallback office. */
export const ART = {
  oak: '#b47c4e',
  walnut: '#5b3b26',
  carpet: '#8d97a2',
  paint: '#efe8dc',
  teal: '#2d5a5f',
  slate: '#33454f',
  trim: '#f5f1e9',
  desk: '#f2f1ee',
  fabric: '#2a2e35',
  green: '#2f6a56',
  leaf: '#3f8f4f',
  glass: '#cfe4ef',
  hub: '#e2e6eb',
} as const;

const c = (hex: string) => new THREE.Color(hex);

export function sceneLook(theme: ResolvedTheme): Look {
  const p = palettes[theme];
  const dark = theme === 'dark';
  const status = {} as Record<EmployeeStatus, THREE.Color>;
  for (const [s, tone] of Object.entries(EMPLOYEE_STATUS_TONE) as [EmployeeStatus, ChipTone][]) {
    status[s] = c(p[`status-${tone}-fg` as keyof ThemePalette]);
  }
  return {
    lightmap: dark ? 0.46 : 1.16,
    tint: dark ? c('#8d9ac4') : c('#ffffff'),
    ao: dark ? 0.8 : 1.0,
    screen: c(dark ? '#b4cbff' : '#eef3ff'),
    screenLevel: dark ? 1.25 : 1.0,
    hub: c('#3b82f6'),
    hubLevel: dark ? 1.6 : 1.4,
    reception: c('#4d6dff'),
    receptionLevel: dark ? 1.9 : 1.6,
    lamp: c('#ffd59c'),
    lampLevel: dark ? 1.5 : 1.05,
    windowColor: dark ? c('#41557d') : c('#dcebf7'),
    glassOpacity: dark ? 0.22 : 0.16,
    hemiSky: dark ? c('#8090c8') : c('#fff6ea'),
    hemiGround: dark ? c('#3a3440') : c('#c9a684'),
    hemiIntensity: dark ? 1.5 : 2.6,
    sun: dark ? c('#9fb2ff') : c('#ffe9cf'),
    sunIntensity: dark ? 0.9 : 2.4,
    fill: dark ? c('#c7d2ff') : c('#fff8f0'),
    fillIntensity: dark ? 0.8 : 1.5,
    rim: dark ? c('#b7c8ff') : c('#fff1dc'),
    rimStrength: dark ? 0.55 : 0.4,
    outline: c(dark ? '#0b0d12' : '#2a2320'),
    shadowOpacity: dark ? 0.3 : 0.24,
    poolLevel: dark ? 0.55 : 0,
    pool: c('#ffb86b'),
    contactShadow: dark ? 0.55 : 0.18,
    status,
    accent: c(dark ? p['accent-text'] : p.accent),
  };
}

const COLOR_KEYS = ['tint', 'screen', 'hub', 'reception', 'lamp', 'windowColor', 'hemiSky', 'hemiGround', 'sun', 'fill', 'rim', 'outline', 'pool', 'accent'] as const;
const NUM_KEYS = ['lightmap', 'ao', 'screenLevel', 'hubLevel', 'receptionLevel', 'lampLevel', 'glassOpacity', 'hemiIntensity', 'sunIntensity', 'fillIntensity', 'rimStrength', 'shadowOpacity', 'poolLevel', 'contactShadow'] as const;

export function cloneLook(a: Look): Look {
  const out = { ...a } as Look;
  for (const k of COLOR_KEYS) out[k] = a[k].clone();
  out.status = {} as Record<EmployeeStatus, THREE.Color>;
  for (const s of Object.keys(a.status) as EmployeeStatus[]) out.status[s] = a.status[s].clone();
  return out;
}

/** Lerp every colour and number of `a` towards `b` into `out`. */
export function mixLook(a: Look, b: Look, t: number, out: Look): Look {
  for (const k of COLOR_KEYS) out[k].lerpColors(a[k], b[k], t);
  for (const k of NUM_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  for (const s of Object.keys(out.status) as EmployeeStatus[]) out.status[s].lerpColors(a.status[s], b.status[s], t);
  return out;
}

/** CSS colours for canvas-drawn text (the Lead Hub screen). */
export interface LabelPalette {
  surface: string;
  fg: string;
  accent: string;
  font: string;
}

export function labelPalette(theme: ResolvedTheme): LabelPalette {
  const p = palettes[theme];
  const font =
    typeof document !== 'undefined' ? getComputedStyle(document.body).fontFamily || 'ui-sans-serif, system-ui, sans-serif' : 'ui-sans-serif, system-ui, sans-serif';
  return { surface: p.surface, fg: p.fg, accent: p.accent, font };
}
