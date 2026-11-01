import type { NodeType } from '@vistar/shared';
import { isTrigger, outputsOf } from './catalog';

/** Layout grid from the contract (template positions use it). */
export const GRID_X = 300;
export const GRID_Y = 150;
/** Snap grid: divides the layout grid so snapped nodes stay aligned with templates. */
export const SNAP = 25;

export const NODE_W = 240;
export const NODE_H = 80;
/** Extra height for the output label strip on branching nodes. */
export const LABEL_STRIP_H = 28;
/** Physical thickness of the card (bottom lip), in px. */
export const LIP = 4;

export interface Size {
  w: number;
  h: number;
}

/** Deterministic card size from type + config (used by cards, ropes, layout and repulsion). */
export function nodeSize(type: NodeType, config: Record<string, unknown>): Size {
  const outs = outputsOf(type, config);
  const w = outs.length > 3 ? Math.min(Math.max(NODE_W, outs.length * 70), 12 * 70) : NODE_W;
  const h = outs.length > 1 ? NODE_H + LABEL_STRIP_H : NODE_H;
  return { w, h };
}

/** Local (card-relative) centre of an output handle. Outputs fan left to right in catalogue order. */
export function sourceHandlePoint(
  type: NodeType,
  config: Record<string, unknown>,
  handle: string | null | undefined,
): { x: number; y: number } {
  const { w, h } = nodeSize(type, config);
  const outs = outputsOf(type, config);
  const i = Math.max(0, outs.indexOf(handle ?? 'out'));
  const k = Math.max(1, outs.length);
  return { x: ((i + 0.5) / k) * w, y: h };
}

export function sourceHandleFraction(index: number, count: number): number {
  return (index + 0.5) / Math.max(1, count);
}

export function targetHandlePoint(
  type: NodeType,
  config: Record<string, unknown>,
): { x: number; y: number } | null {
  if (isTrigger(type)) return null;
  const { w } = nodeSize(type, config);
  return { x: w / 2, y: 0 };
}

export const snap = (v: number, step = SNAP) => Math.round(v / step) * step;
