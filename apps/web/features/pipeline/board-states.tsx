'use client';

import { RotateCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBoardWords } from './words';

const SKELETON_CARDS = [3, 2, 4, 2, 1, 1];

/** Skeleton block with a subtle moving shimmer (transform only; off with reduced motion). */
function Bone({ className }: { className: string }) {
  return <div aria-hidden className={`vb-shimmer rounded-md bg-skeleton ${className}`} />;
}

/** Column-shaped skeleton (same widths and toolbar row as the real board, so nothing jumps). */
export function BoardSkeleton() {
  return (
    <div role="status" className="flex min-h-0 flex-1 flex-col">
      <span className="sr-only">Loading board</span>
      <div aria-hidden className="flex min-h-9 items-center pb-2">
        <Bone className="h-3 w-36" />
      </div>
      <div aria-hidden className="flex min-h-0 flex-1 gap-3 overflow-hidden pb-2">
        {SKELETON_CARDS.map((cards, i) => (
          <div key={i} className="flex w-[85vw] max-w-[320px] shrink-0 flex-col gap-2 rounded-lg border border-border bg-surface-2 p-2 md:w-[288px]">
            <div className="flex items-center gap-2 px-1 py-1">
              <Bone className="size-2 rounded-full" />
              <Bone className="h-4 w-24" />
              <Bone className="ml-auto h-4 w-10" />
            </div>
            {Array.from({ length: cards }, (_, j) => (
              <div key={j} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-card">
                <div className="flex gap-2">
                  <Bone className="h-4 flex-1" />
                  <Bone className="h-4 w-10" />
                </div>
                <Bone className="h-3 w-2/3" />
                <div className="flex items-center gap-1.5">
                  <Bone className="size-5 rounded-full" />
                  <Bone className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function BoardError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  const words = useBoardWords();
  return (
    <div role="alert" className="mx-auto mt-10 flex w-full max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-surface p-8 text-center shadow-card">
      <TriangleAlert aria-hidden className="size-5 text-danger-text" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-fg">Could not load the board</p>
        <p className="text-xs text-muted">The {words.manyLower} did not arrive. Check your connection, then try again.</p>
      </div>
      <Button onClick={onRetry} loading={retrying}>
        <RotateCw aria-hidden />
        Try again
      </Button>
    </div>
  );
}
