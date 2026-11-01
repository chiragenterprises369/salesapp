'use client';

import { Box, LayoutGrid, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import type { FloorViewMode } from '../state/types';

export function FloorToolbar({
  view,
  onView,
  canChooseView,
  paused,
  onPause,
  stress,
}: {
  view: FloorViewMode;
  onView: (view: FloorViewMode) => void;
  canChooseView: boolean;
  paused: boolean;
  onPause: (paused: boolean) => void;
  stress: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-strong" aria-live="off">
        <span aria-hidden className={cn('size-2 rounded-full', paused ? 'bg-status-grey-fg' : 'bg-status-green-fg motion-safe:animate-pulse')} />
        {paused ? 'Paused' : 'Live'}
      </p>
      {stress > 0 && (
        <span className="rounded-full border border-status-amber-border bg-status-amber-bg px-2 py-0.5 text-2xs font-medium text-status-amber-fg">
          Dev stress: {stress}
        </span>
      )}
      <Button size="sm" variant="ghost" onClick={() => onPause(!paused)} aria-pressed={paused}>
        {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
        {paused ? 'Resume updates' : 'Pause updates'}
      </Button>
      {canChooseView && (
        <div role="group" aria-label="Floor view" className="inline-flex rounded-md border border-border bg-surface p-0.5 shadow-card">
          {(
            [
              ['3d', '3D', Box],
              ['flat', 'Flat', LayoutGrid],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => onView(value)}
              className={cn(
                'focus-ring inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium transition-colors duration-150 ease-standard',
                view === value ? 'bg-accent-soft text-accent-soft-fg' : 'text-fg-secondary hover:bg-surface-2 hover:text-fg',
              )}
            >
              <Icon aria-hidden className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
