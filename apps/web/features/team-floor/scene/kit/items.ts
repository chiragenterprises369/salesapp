import { KIT_CHAIR, KIT_MONITOR, KIT_STOOL } from '../../state/layout/kit';
import { ART } from '../look';

/**
 * Low-poly parts of every module-kit item (SPEC 12.1 / D-054 look: matte, rounded proportions, the
 * authored palette). Each part is a unit primitive scaled and placed in the item's frame (x = width,
 * y = up, z = depth; the front faces +z, the item's heading). Parts of the same primitive and material
 * are drawn as one InstancedMesh for the whole floor, so a 200-desk office stays at ~25 draw calls.
 */

export type PartGeo = 'box' | 'cyl' | 'ico';
export type PartMat =
  | 'deskTop'
  | 'deskFrame'
  | 'walnut'
  | 'meeting'
  | 'fabric'
  | 'sofa'
  | 'marble'
  | 'counterTop'
  | 'cabinet'
  | 'pot'
  | 'leaf'
  | 'board'
  | 'metal'
  | 'dark'
  | 'device'
  | 'booth'
  | 'glass'
  | 'water'
  | 'bookA'
  | 'bookB'
  | 'bookC'
  | 'accent';

export interface Part {
  geo: PartGeo;
  mat: PartMat;
  /** Centre in the item frame (metres; y = up from the floor). */
  pos: [number, number, number];
  size: [number, number, number];
  rotY?: number;
}

export const PART_COLOR: Record<Exclude<PartMat, 'accent'>, string> = {
  deskTop: ART.desk,
  deskFrame: '#c4c8ce',
  walnut: ART.walnut,
  meeting: '#9a6a45',
  fabric: ART.fabric,
  sofa: ART.green,
  marble: '#f4f2ee',
  counterTop: '#3a3f47',
  cabinet: ART.trim,
  pot: '#e7e2da',
  leaf: ART.leaf,
  board: '#fbfbfa',
  metal: '#9aa1aa',
  dark: '#1f2329',
  device: '#d9dce0',
  booth: ART.teal,
  glass: ART.glass,
  water: '#9cc9e8',
  bookA: '#8a6d4b',
  bookB: '#4f6d8a',
  bookC: '#a8a29e',
};

const box = (mat: PartMat, x: number, y: number, z: number, sx: number, sy: number, sz: number): Part => ({ geo: 'box', mat, pos: [x, y, z], size: [sx, sy, sz] });
const cyl = (mat: PartMat, x: number, y: number, z: number, r: number, h: number): Part => ({ geo: 'cyl', mat, pos: [x, y, z], size: [r, h, r] });

function desk(w: number, d: number, top: PartMat = 'deskTop', frame: PartMat = 'deskFrame'): Part[] {
  return [box(top, 0, 0.735, 0, w, 0.03, d), box(frame, -w / 2 + 0.03, 0.36, 0, 0.03, 0.72, d - 0.08), box(frame, w / 2 - 0.03, 0.36, 0, 0.03, 0.72, d - 0.08), box(frame, 0, 0.5, -d / 2 + 0.05, w - 0.1, 0.3, 0.02)];
}

function pod(w: number): Part[] {
  const legs = Math.round(w / 1.4);
  const out: Part[] = [box('deskTop', 0, 0.735, 0, w, 0.03, 1.5), box('sofa', 0, 0.93, 0, w - 0.04, 0.36, 0.03)];
  for (let i = 0; i <= legs; i++) out.push(box('deskFrame', -w / 2 + 0.03 + (i * (w - 0.06)) / legs, 0.36, 0, 0.03, 0.72, 1.38));
  return out;
}

function shelf(): Part[] {
  const out: Part[] = [box('cabinet', -0.78, 0.9, 0, 0.04, 1.8, 0.4), box('cabinet', 0.78, 0.9, 0, 0.04, 1.8, 0.4), box('cabinet', 0, 0.9, -0.18, 1.56, 1.8, 0.02)];
  for (let i = 0; i < 5; i++) out.push(box('cabinet', 0, 0.04 + i * 0.43, 0, 1.56, 0.03, 0.38));
  const books: PartMat[] = ['bookA', 'bookB', 'bookC'];
  for (let i = 0; i < 4; i++) for (let b = 0; b < 3; b++) out.push(box(books[(i + b) % 3]!, -0.5 + b * 0.42 + (i % 2) * 0.1, 0.2 + i * 0.43, 0.02, 0.3, 0.26 + ((i + b) % 2) * 0.05, 0.24));
  return out;
}

/** Parts per prop type of a custom template (plan item kinds plus the seat chairs and monitors). */
export function kitParts(type: string): Part[] {
  switch (type) {
    case 'desk':
      return desk(1.4, 0.7);
    case 'desk_pod_4':
      return pod(2.8);
    case 'desk_pod_6':
      return pod(4.2);
    case 'manager_desk':
      return [box('walnut', 0, 0.74, 0, 1.8, 0.04, 0.85), box('walnut', 0.55, 0.36, 0, 0.5, 0.72, 0.75), box('walnut', -0.86, 0.36, 0, 0.04, 0.72, 0.75), box('walnut', 0, 0.48, -0.38, 1.7, 0.36, 0.03)];
    case 'meeting_table':
      return [box('meeting', 0, 0.72, 0, 2.4, 0.04, 1.1), box('dark', -0.75, 0.36, 0, 0.12, 0.7, 0.6), box('dark', 0.75, 0.36, 0, 0.12, 0.7, 0.6)];
    case 'phone_booth':
      // Open-top booth (the fixed camera looks down into it): felt back and sides, glass front, shelf.
      return [box('booth', 0, 1.1, -0.57, 1.2, 2.2, 0.06), box('booth', -0.57, 1.1, 0, 0.06, 2.2, 1.2), box('booth', 0.57, 1.1, 0, 0.06, 2.2, 1.2), box('glass', 0, 1.1, 0.58, 1.08, 2.1, 0.02), box('walnut', 0, 1.0, -0.4, 0.9, 0.03, 0.3)];
    case 'sofa':
      return [box('sofa', 0, 0.22, 0.04, 1.96, 0.42, 0.78), box('sofa', 0, 0.6, -0.33, 2.0, 0.42, 0.2), box('sofa', -0.92, 0.42, 0, 0.16, 0.42, 0.85), box('sofa', 0.92, 0.42, 0, 0.16, 0.42, 0.85)];
    case 'armchair':
      return [box('sofa', 0, 0.22, 0.04, 0.82, 0.42, 0.78), box('sofa', 0, 0.6, -0.33, 0.85, 0.42, 0.18), box('sofa', -0.36, 0.42, 0, 0.13, 0.4, 0.82), box('sofa', 0.36, 0.42, 0, 0.13, 0.4, 0.82)];
    case 'coffee_table':
      return [box('walnut', 0, 0.4, 0, 1.0, 0.04, 0.6), box('walnut', 0, 0.2, 0, 0.8, 0.36, 0.4)];
    case 'reception_desk':
      return [box('marble', 0, 0.5, 0, 2.4, 1.0, 0.8), box('walnut', 0, 1.03, 0.02, 2.46, 0.05, 0.86), box('accent', 0, 0.04, 0.405, 2.3, 0.03, 0.01)];
    case 'pantry_counter':
      return [box('cabinet', 0, 0.43, 0, 2.4, 0.86, 0.62), box('counterTop', 0, 0.885, 0.01, 2.44, 0.05, 0.66), box('metal', 0.6, 0.93, -0.1, 0.45, 0.04, 0.35)];
    case 'plant':
      return [cyl('pot', 0, 0.2, 0, 0.2, 0.4), { geo: 'ico', mat: 'leaf', pos: [0, 0.82, 0], size: [0.4, 0.5, 0.4] }, { geo: 'ico', mat: 'leaf', pos: [0.08, 1.12, -0.05], size: [0.26, 0.3, 0.26] }];
    case 'whiteboard':
      return [box('board', 0, 1.35, 0, 1.6, 0.95, 0.03), box('metal', -0.78, 0.95, 0, 0.04, 1.9, 0.04), box('metal', 0.78, 0.95, 0, 0.04, 1.9, 0.04), box('metal', -0.78, 0.02, 0, 0.06, 0.04, 0.5), box('metal', 0.78, 0.02, 0, 0.06, 0.04, 0.5)];
    case 'printer':
      return [box('cabinet', 0, 0.3, 0, 0.6, 0.6, 0.5), box('device', 0, 0.78, 0, 0.55, 0.36, 0.45), box('dark', 0, 0.97, 0.05, 0.4, 0.02, 0.2)];
    case 'tv_screen':
      return [box('metal', 0, 0.02, 0, 0.6, 0.03, 0.4), box('metal', 0, 0.6, -0.04, 0.06, 1.2, 0.06), box('dark', 0, 1.2, 0, 1.4, 0.8, 0.05)];
    case 'water_cooler':
      return [box('cabinet', 0, 0.47, 0, 0.3, 0.94, 0.3), cyl('water', 0, 1.12, 0, 0.13, 0.36)];
    case 'shelf':
      return shelf();
    case KIT_CHAIR:
      return [box('fabric', 0, 0.45, 0.02, 0.48, 0.07, 0.46), box('fabric', 0, 0.78, -0.21, 0.46, 0.52, 0.06), cyl('metal', 0, 0.22, 0, 0.03, 0.42), cyl('dark', 0, 0.03, 0, 0.27, 0.05)];
    case KIT_STOOL:
      return [cyl('fabric', 0, 0.45, 0, 0.2, 0.07), cyl('metal', 0, 0.22, 0, 0.03, 0.42), cyl('dark', 0, 0.02, 0, 0.2, 0.04)];
    case KIT_MONITOR:
      // Monitor on the desk top (prop.y): stand, neck, panel; the screen quad is drawn separately.
      return [box('dark', 0, 0.008, 0, 0.22, 0.016, 0.16), box('dark', 0, 0.12, -0.02, 0.04, 0.22, 0.03), box('dark', 0, 0.36, 0, 0.56, 0.34, 0.025)];
    default:
      return [];
  }
}

/** Screen face of a kit monitor in its frame (centre, width, height); faces +z towards the person. */
export const MONITOR_SCREEN = { pos: [0, 0.36, 0.0135] as [number, number, number], w: 0.52, h: 0.3 };
