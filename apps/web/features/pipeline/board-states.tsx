'use client';

import { RotateCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const SKELETON_CARDS = [3, 2, 4, 2, 1, 1];

/** Column-shaped skeleton (same widths as the real board, so nothing jumps). */
export function BoardSkeleton() {
  return (
    <div role="status" className="flex min-h-0 flex-1 gap-3 overflow-hidden pb-2">
      <span className="sr-only">Loading board</span>
      {SKELETON_CARDS.map((cards, i) => (
        <div key={i} aria-hidden className="flex w-[85vw] max-w-80 shrink-0 flex-col gap-2 rounded-lg border border-border bg-surface-2 p-2 md:w-72">
          <div className="flex items-center gap-2 px-1 py-1">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="ml-auto h-4 w-10" />
          </div>
          {Array.from({ length: cards }, (_, j) => (
            <div key={j} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
              <div className="flex gap-2">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-10" />
              </div>
              <Skeleton className="h-3 w-2/3" />
              <div className="flex items-center gap-1.5">
                <Skeleton className="size-5 rounded-full" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function BoardError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div role="alert" className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-surface p-8 text-center">
      <TriangleAlert aria-hidden className="size-5 text-danger-text" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-fg">Could not load the board</p>
        <p className="text-xs text-muted">The leads did not arrive. Check your connection, then try again.</p>
      </div>
      <Button onClick={onRetry} loading={retrying}>
        <RotateCw aria-hidden />
        Try again
      </Button>
    </div>
  );
}
