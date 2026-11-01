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
  /** Select mode: the other selected leads travelling with this one as a deck (board order). */
  deck: readonly LeadListItem[];
  deckIds: ReadonlySet<string>;
  fromStageId: string;
  /** Index of the card in its origin column (with the card itself). */
  originIndex: number;
  width: number;
  height: number;
  /** Pointer offset inside the card; pivot for lift and tilt. */
  grabX: number;
  grabY: number;
  mode: DragMode;
  /** Touch pick-up by long-press (press-and-release without moving opens the actions sheet). */
  viaLongPress: boolean;
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

/**
 * A card travelling between two places in the overlay layer along an arc: a realtime move by
 * someone else, a menu move, a deck card, or a rollback after a failed save.
 */
export interface Flight {
  key: string;
  lead: LeadListItem;
  from: Rect;
  to: Rect;
  kind: 'move' | 'rollback';
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
  /** Confirmation ring (pulses in the stage colour after a drop). */
  ring: HTMLElement | null;
  /** Vertical nudge (neighbours make room, FLIP after data changes). Transform only. */
  y: SpringValue<number>;
  /** Rest layout in list coordinates (kept fresh by the column layout pass). */
  restTop: number;
  height: number;
  /** Last nudge target applied. */
  shift: number;
  /** Staggered nudge timer (gap wave). */
  shiftTimer: number;
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

/** Springs of the lifted card in the overlay (DragLayer). */
export interface OverlayHandle {
  x: SpringValue<number>;
  y: SpringValue<number>;
  rx: SpringValue<number>;
  ry: SpringValue<number>;
  rz: SpringValue<number>;
  scale: SpringValue<number>;
  /** 0..1: lift (translateZ, shadow growth). */
  lift: SpringValue<number>;
  /** Shadow offset, opposite to the motion. */
  sx: SpringValue<number>;
  sy: SpringValue<number>;
}

/** What the board commits through useMoveLead. */
export interface CommitMove {
  lead: LeadListItem;
  fromStageId: string;
  toStageId: string;
  beforeLeadId: string | null;
  afterLeadId: string | null;
}
