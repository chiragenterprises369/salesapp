'use client';

import type { Lead, Stage } from '@vistar/shared';
import { Check, Trophy, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/cn';
import { usePipelineStages } from '@/components/leads/use-stages';

/**
 * Stage progress: open stages as steps, then Won / Lost. Click a stage to move the lead;
 * Won and Lost ask for confirmation (they close the deal and stop follow-up workflows).
 */
export function StageProgress({
  lead,
  disabled,
  onMove,
}: {
  lead: Pick<Lead, 'name' | 'stageId'>;
  disabled?: boolean;
  onMove: (stage: Stage) => Promise<unknown> | void;
}) {
  const [confirm, setConfirm] = useState<Stage | null>(null);
  const [busy, setBusy] = useState(false);
  const { stages } = usePipelineStages();
  const open = stages.filter((s) => s.type === 'open');
  const closed = stages.filter((s) => s.type !== 'open');
  const current = stages.find((s) => s.id === lead.stageId);
  const currentIdx = open.findIndex((s) => s.id === lead.stageId);
  const isClosed = current?.type !== 'open';

  const choose = (s: Stage) => {
    if (s.id === lead.stageId || disabled) return;
    if (s.type !== 'open') setConfirm(s);
    else void onMove(s);
  };

  return (
    <div>
      <ol aria-label="Pipeline stage" className="flex gap-1">
        {open.map((s, i) => {
          const isCurrent = s.id === lead.stageId;
          const done = isClosed ? current?.type === 'won' : i < currentIdx;
          return (
            <li key={s.id} className="min-w-0 flex-1">
              <button
                type="button"
                disabled={disabled}
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={`${s.name}${isCurrent ? ', current stage' : done ? ', completed' : ''}`}
                onClick={() => choose(s)}
                className={cn(
                  'focus-ring group flex w-full min-w-0 flex-col gap-1 rounded-sm text-left disabled:cursor-default',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'h-1.5 w-full rounded-full transition-colors duration-200',
                    isCurrent
                      ? 'bg-accent'
                      : done
                        ? 'bg-status-indigo-border'
                        : 'bg-surface-3 group-enabled:group-hover:bg-border-strong',
                  )}
                />
                <span
                  className={cn(
                    'items-center gap-1 truncate text-2xs font-medium',
                    isCurrent ? 'text-accent-text' : done ? 'text-fg-secondary' : 'text-muted',
                    'hidden sm:flex',
                  )}
                >
                  {done && <Check aria-hidden className="size-3 shrink-0" />}
                  <span className="truncate">{s.name}</span>
                </span>
              </button>
            </li>
          );
        })}
        {closed.map((s) => {
          const isCurrent = s.id === lead.stageId;
          const won = s.type === 'won';
          return (
            <li key={s.id} className="shrink-0">
              <button
                type="button"
                disabled={disabled}
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={`${won ? 'Mark won' : 'Mark lost'}${isCurrent ? ', current stage' : ''}`}
                onClick={() => choose(s)}
                className={cn(
                  'focus-ring inline-flex h-6 items-center gap-1 rounded-full border px-2 text-2xs font-medium transition-colors duration-150 disabled:cursor-default',
                  isCurrent
                    ? won
                      ? 'border-status-green-border bg-status-green-bg text-status-green-fg'
                      : 'border-status-red-border bg-status-red-bg text-status-red-fg'
                    : 'border-border bg-surface text-fg-secondary enabled:hover:bg-surface-2',
                )}
              >
                {won ? (
                  <Trophy aria-hidden className="size-3" />
                ) : (
                  <XCircle aria-hidden className="size-3" />
                )}
                {s.name}
              </button>
            </li>
          );
        })}
      </ol>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              {confirm?.type === 'won' ? `Mark ${lead.name} as won?` : `Mark ${lead.name} as lost?`}
            </DialogTitle>
            <DialogDescription>
              {confirm?.type === 'won'
                ? 'The deal value counts towards revenue and open follow-up workflows stop.'
                : 'Open follow-up workflows stop. You can reopen the lead by moving it to an open stage.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody />
          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button
              variant={confirm?.type === 'won' ? 'primary' : 'danger'}
              loading={busy}
              onClick={async () => {
                if (!confirm) return;
                setBusy(true);
                try {
                  await onMove(confirm);
                } finally {
                  setBusy(false);
                  setConfirm(null);
                }
              }}
            >
              {confirm?.type === 'won' ? 'Mark won' : 'Mark lost'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
