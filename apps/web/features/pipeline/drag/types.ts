import type { SpringValue } from '@react-spring/web';
import type { LeadListItem } from '@vistar/shared';

/** Screen-space rectangle (viewport px). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DragMode = 'pointer' | 'keyboard';
export type DragPhase = 'idle' | 'dragging' | 'dropping';

export interface ActiveDrag {
  lead: LeadListItem;
  fromStageId: string;
  /** Index of the card in its origin column (with the card itself). */
  originIndex: number;
  width: number;
  height: number;
  /** Pointer offset inside the card; pivot for lift and tilt. */
  grabX: number;
  grabY: number;
  mode: DragMode;
}

/**
 * Drop slot. `index` is the insertion index among the column's cards WITHOUT the dragged card.
 * `top` is the slot's top edge in list coordinates (rest layout, before neighbour nudges).
 */
export interface DropTarget {
  stageId: string;
  index: number;
  top: number;
}

/** A card flying between two places in the overlay layer (e.g. rollback springs it back). */
export interface Flight {
  key: string;
  lead: LeadListItem;
  from: Rect;
  to: Rect;
}

export interface DragState {
  phase: DragPhase;
  active: ActiveDrag | null;
  over: DropTarget | null;
  flights: Flight[];
}

/** A mounted card, registered by BoardCard. */
export interface CardHandle {
  id: string;
  stageId: string;
  li: HTMLElement;
  card: HTMLElement;
  list: HTMLElement;
  /** Vertical nudge (neighbours make room, FLIP after data changes). Transform only. */
  y: SpringValue<number>;
  /** Rest layout in list coordinates (kept fresh by the column layout pass). */
  restTop: number;
  height: number;
  /** Last nudge target applied. */
  shift: number;
}

/** A column frame, registered by BoardColumn. */
export interface ColumnHandle {
  stageId: string;
  frame: HTMLElement;
  scroll: HTMLElement;
}

/** Cards and geometry of one column, registered by the static or the virtual list. */
export interface ColumnGeometry {
  list: HTMLElement;
  /** Cards in display order (always the latest render). */
  getLeads: () => readonly LeadListItem[];
  /** Rest top/height of a card in list coordinates. */
  slot: (id: string) => { top: number; height: number } | null;
  /** Re-measure (drag start). */
  refresh: () => void;
  /** Make sure the card at `index` is mounted (virtual lists). */
  reveal: (index: number) => void;
}

export interface OverlayHandle {
  x: SpringValue<number>;
  y: SpringValue<number>;
  rot: SpringValue<number>;
  scale: SpringValue<number>;
}

/** What the board commits through useMoveLead. */
export interface CommitMove {
  lead: LeadListItem;
  fromStageId: string;
  toStageId: string;
  beforeLeadId: string | null;
  afterLeadId: string | null;
}
