'use client';

import { formatInr, formatNumber } from '@vistar/shared';
import { ListChecks, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useLeadsViewState } from '@/lib/leads/state';

/**
 * Small board toolbar: totals, refresh state and the "Select" toggle. The bulk actions bar itself
 * belongs to the Leads page shell and reads the same selection store.
 */
export function BoardToolbar({
  totalCount,
  totalValue,
  updating,
  refreshFailed,
  onRetry,
  canSelect,
  filtersActive,
}: {
  totalCount: number;
  totalValue: number;
  updating: boolean;
  refreshFailed: boolean;
  onRetry: () => void;
  canSelect: boolean;
  filtersActive: boolean;
}) {
  const selectMode = useLeadsViewState((s) => s.boardSelectMode);
  const selectedCount = useLeadsViewState((s) => s.selectedIds.size);
  const setBoardSelectMode = useLeadsViewState((s) => s.setBoardSelectMode);
  const setSelected = useLeadsViewState((s) => s.setSelected);
  const resetFilters = useLeadsViewState((s) => s.resetFilters);
  const noMatches = filtersActive && totalCount === 0;

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 pb-2">
      <p className="text-xs text-muted-strong tabular">
        {noMatches ? (
          'No leads match these filters.'
        ) : (
          <>
            <span className="font-medium text-fg-secondary">{formatNumber(totalCount)}</span> {totalCount === 1 ? 'lead' : 'leads'} ·{' '}
            <span className="font-medium text-fg-secondary">{formatInr(totalValue, { compact: true })}</span> total
          </>
        )}
      </p>
      {noMatches && (
        <Button size="sm" variant="ghost" onClick={resetFilters}>
          Clear filters
        </Button>
      )}
      {updating && (
        <span role="status" className="text-xs text-muted-strong">
          Updating…
        </span>
      )}
      {refreshFailed && (
        <span role="alert" className="flex items-center gap-1 text-xs text-danger-text">
          Could not refresh the board.
          <Button size="sm" variant="ghost" onClick={onRetry}>
            <RotateCw aria-hidden />
            Retry
          </Button>
        </span>
      )}
      {canSelect && (
        <div className="ml-auto flex items-center gap-2">
          {selectMode && (
            <>
              <span role="status" className="text-xs font-medium text-fg-secondary tabular">
                {selectedCount === 0 ? 'Select leads' : `${formatNumber(selectedCount)} selected`}
              </span>
              {selectedCount > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                  Clear
                </Button>
              )}
            </>
          )}
          <Button
            size="sm"
            aria-pressed={selectMode}
            onClick={() => setBoardSelectMode(!selectMode)}
            className={cn(selectMode && 'border-status-indigo-border bg-accent-soft text-accent-soft-fg hover:bg-accent-soft')}
          >
            <ListChecks aria-hidden />
            Select
          </Button>
        </div>
      )}
    </div>
  );
}
