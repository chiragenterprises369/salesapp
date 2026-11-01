'use client';

import { Skeleton } from '@/components/ui/skeleton';

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

export function LeadsBoardView(_props: LeadsBoardViewProps) {
  return (
    <div className="flex gap-3 overflow-x-auto p-1" aria-busy="true" aria-label="Board loading">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-surface-2 p-2">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ))}
    </div>
  );
}
