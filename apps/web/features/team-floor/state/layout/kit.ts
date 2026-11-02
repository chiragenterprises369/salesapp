import type { FloorPlan } from '@vistar/shared';

/**
 * Module kit for published floor plans (format `layout_json`, SPEC 29.11 and D-054): the size,
 * height and look of every FLOOR_PLAN_ITEM_KINDS item. Pure data shared by the template builder
 * (walk obstacles, monitors), the 3D kit (scene/kit) and the flat plan colours. Sizes are metres in
 * the item's own frame: width along x, depth along z; `rotation` turns the item like a seat heading.
 */

export type PlanItemKind = FloorPlan['items'][number]['kind'];

export type KitTone = 'desk' | 'walnut' | 'meeting' | 'sofa' | 'marble' | 'counter' | 'plant' | 'board' | 'device' | 'screen' | 'booth' | 'shelf' | 'hub' | 'water';

export interface KitItemSpec {
  /** Footprint [width, depth] (rect) or radius in `size[0]` (round). */
  size: [number, number];
  height: number;
  shape: 'rect' | 'round';
  /** People walk around it (false: thin wall items people pass in front of are still blocked). */
  blocks: boolean;
  /** Work surface people sit at (monitors are placed on it in front of desk seats). */
  surface: boolean;
  tone: KitTone;
  label: string;
}

export const KIT_ITEMS: Record<PlanItemKind, KitItemSpec> = {
  desk: { size: [1.4, 0.7], height: 0.75, shape: 'rect', blocks: true, surface: true, tone: 'desk', label: 'Desk' },
  desk_pod_4: { size: [2.8, 1.5], height: 0.75, shape: 'rect', blocks: true, surface: true, tone: 'desk', label: 'Desk pod (4)' },
  desk_pod_6: { size: [4.2, 1.5], height: 0.75, shape: 'rect', blocks: true, surface: true, tone: 'desk', label: 'Desk pod (6)' },
  manager_desk: { size: [1.8, 0.85], height: 0.76, shape: 'rect', blocks: true, surface: true, tone: 'walnut', label: 'Manager desk' },
  meeting_table: { size: [2.4, 1.1], height: 0.74, shape: 'rect', blocks: true, surface: true, tone: 'meeting', label: 'Meeting table' },
  phone_booth: { size: [1.2, 1.2], height: 2.2, shape: 'rect', blocks: true, surface: false, tone: 'booth', label: 'Phone booth' },
  sofa: { size: [2.0, 0.85], height: 0.8, shape: 'rect', blocks: true, surface: false, tone: 'sofa', label: 'Sofa' },
  armchair: { size: [0.85, 0.85], height: 0.8, shape: 'rect', blocks: true, surface: false, tone: 'sofa', label: 'Armchair' },
  coffee_table: { size: [1.0, 0.6], height: 0.42, shape: 'rect', blocks: true, surface: false, tone: 'walnut', label: 'Coffee table' },
  reception_desk: { size: [2.4, 0.8], height: 1.05, shape: 'rect', blocks: true, surface: true, tone: 'marble', label: 'Reception desk' },
  pantry_counter: { size: [2.4, 0.65], height: 0.92, shape: 'rect', blocks: true, surface: false, tone: 'counter', label: 'Pantry counter' },
  plant: { size: [0.3, 0.3], height: 1.2, shape: 'round', blocks: true, surface: false, tone: 'plant', label: 'Plant' },
  whiteboard: { size: [1.6, 0.12], height: 1.9, shape: 'rect', blocks: true, surface: false, tone: 'board', label: 'Whiteboard' },
  printer: { size: [0.6, 0.5], height: 1.0, shape: 'rect', blocks: true, surface: false, tone: 'device', label: 'Printer' },
  tv_screen: { size: [1.4, 0.14], height: 1.6, shape: 'rect', blocks: true, surface: false, tone: 'screen', label: 'TV screen' },
  water_cooler: { size: [0.22, 0.22], height: 1.1, shape: 'round', blocks: true, surface: false, tone: 'water', label: 'Water cooler' },
  shelf: { size: [1.6, 0.4], height: 1.8, shape: 'rect', blocks: true, surface: false, tone: 'shelf', label: 'Shelf' },
  lead_hub: { size: [0.55, 0.55], height: 1.2, shape: 'round', blocks: true, surface: false, tone: 'hub', label: 'Lead Hub' },
};

/** Props the custom template adds for every seat (chairs) and desk seat (monitors). */
export const KIT_CHAIR = 'kit_chair';
export const KIT_MONITOR = 'kit_monitor';
export const KIT_STOOL = 'kit_stool';

/** Floor finish of a plan -> template floor (3D kit textures and the flat plan colours). */
export const PLAN_FLOOR: Record<FloorPlan['floorMaterial'], 'oak' | 'carpet' | 'walnut' | 'stone'> = {
  wood: 'oak',
  carpet: 'carpet',
  tile: 'stone',
  concrete: 'stone',
};

export function isKitItem(type: string): type is PlanItemKind {
  return type in KIT_ITEMS;
}
