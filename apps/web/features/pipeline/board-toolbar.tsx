'use client';

import { formatInr, formatNumber, type BoardSkin } from '@vistar/shared';
import { Info, ListChecks, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useLeadsViewState } from '@/lib/leads/state';
import { SkinPicker } from './skins/skin-picker';
import { TOUCH_BUTTON } from './touch';
import { countOf, useBoardWords } from './words';

/**
 * Small board toolbar: totals, refresh state, the board skin picker (Flat, Depth, Neon Space) and
 * the "Select" toggle. The bulk actions bar itself belongs to the Leads page shell and reads the
 * same selection store.
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
  skin,
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
  skin: {
    requested: BoardSkin;
    userChoice: BoardSkin | null;
    workspaceDefault: BoardSkin;
    /** Why the device or the frame rate paints another skin (null when it paints the requested one). */
    note: string | null;
    onChange: (skin: BoardSkin | null) => void;
  };
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
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
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
        <p role="status" data-board-skin-note="" className={cn('flex items-center gap-1 text-xs text-muted-strong', !skin.note && 'sr-only')}>
          {skin.note && (
            <>
              <Info aria-hidden className="size-3.5 shrink-0" />
              {skin.note}
            </>
          )}
        </p>
        <SkinPicker requested={skin.requested} userChoice={skin.userChoice} workspaceDefault={skin.workspaceDefault} touch={touch} onChange={skin.onChange} />
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
