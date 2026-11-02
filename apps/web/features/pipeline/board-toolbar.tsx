'use client';

import { formatInr, formatNumber } from '@vistar/shared';
import { Layers, ListChecks, RotateCw, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useLeadsViewState } from '@/lib/leads/state';
import { TOUCH_BUTTON, TOUCH_ICON } from './touch';
import { countOf, useBoardWords } from './words';

/**
 * Small board toolbar: totals, refresh state, Flat mode and the "Select" toggle. The bulk actions
 * bar itself belongs to the Leads page shell and reads the same selection store.
 */
export function BoardToolbar({
  totalCount,
  totalValue,
  updating,
  refreshFailed,
  onRetry,
  canSelect,
  filtersActive,
  touch,
  flat,
  onToggleFlat,
}: {
  totalCount: number;
  totalValue: number;
  updating: boolean;
  refreshFailed: boolean;
  onRetry: () => void;
  canSelect: boolean;
  filtersActive: boolean;
  /** 44 px targets (compact density, coarse pointers). */
  touch: boolean;
  flat: boolean;
  onToggleFlat: () => void;
}) {
  const words = useBoardWords();
  const selectMode = useLeadsViewState((s) => s.boardSelectMode);
  const selectedCount = useLeadsViewState((s) => s.selectedIds.size);
  const setBoardSelectMode = useLeadsViewState((s) => s.setBoardSelectMode);
  const setSelected = useLeadsViewState((s) => s.setSelected);
  const resetFilters = useLeadsViewState((s) => s.resetFilters);
  const noMatches = filtersActive && totalCount === 0;
  const size = touch ? 'touch' : 'sm';
  const touchClass = touch ? TOUCH_BUTTON : undefined;

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 pb-2">
      <p className="text-xs text-muted-strong tabular">
        {noMatches ? (
          `No ${words.manyLower} match these filters.`
        ) : (
          <>
            <span className="font-medium text-fg-secondary">{formatNumber(totalCount)}</span> {countOf(totalCount, words)} ·{' '}
            <span className="font-medium text-fg-secondary">{formatInr(totalValue, { compact: true })}</span> total
          </>
        )}
      </p>
      {noMatches && (
        <Button size={size} className={touchClass} variant="ghost" onClick={resetFilters}>
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
          <Button size={size} className={touchClass} variant="ghost" onClick={onRetry}>
            <RotateCw aria-hidden />
            Retry
          </Button>
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        {canSelect && selectMode && (
          <>
            <span role="status" className="text-xs font-medium text-fg-secondary tabular">
              {selectedCount === 0 ? `Select ${words.manyLower}` : `${formatNumber(selectedCount)} selected`}
            </span>
            {selectedCount > 0 && (
              <Button size={size} className={touchClass} variant="ghost" onClick={() => setSelected([])}>
                Clear
              </Button>
            )}
          </>
        )}
        <Button
          size={touch ? 'icon-touch' : 'icon-sm'}
          variant="ghost"
          aria-pressed={flat}
          aria-label="Flat mode"
          title={flat ? 'Flat mode is on: plain cards, no physics' : 'Flat mode: plain cards, no physics'}
          onClick={onToggleFlat}
          className={cn(touch && TOUCH_ICON, flat && 'bg-surface-3 text-fg')}
        >
          {flat ? <Square aria-hidden /> : <Layers aria-hidden />}
        </Button>
        {canSelect && (
          <Button
            size={size}
            aria-pressed={selectMode}
            onClick={() => setBoardSelectMode(!selectMode)}
            className={cn(touchClass, selectMode && 'border-status-indigo-border bg-accent-soft text-accent-soft-fg hover:bg-accent-soft')}
          >
            <ListChecks aria-hidden />
            Select
          </Button>
        )}
      </div>
    </div>
  );
}
