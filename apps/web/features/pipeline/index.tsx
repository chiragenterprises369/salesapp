'use client';

import { BoardView } from './board-view';

/**
 * PUBLIC API of features/pipeline (contract; owner frontend-physics replaces the implementation,
 * keeps the export name and props). Mounted by the Leads page (frontend-app) in the Board slot.
 * Reads filters/selection/scroll from useLeadsViewState and data from useLeadsBoard/useMoveLead.
 */
export interface LeadsBoardViewProps {
  pipelineId: string;
  /** Employee panel / mobile: compact cards and 44px touch targets. */
  density?: 'default' | 'compact';
}

/**
 * WorkDo-style kanban for one pipeline: tinted stage columns, spring-physics drag and drop with a
 * keyboard and menu alternative, select mode for bulk actions, quick add, virtualised long columns.
 */
export function LeadsBoardView(props: LeadsBoardViewProps) {
  return <BoardView {...props} />;
}
