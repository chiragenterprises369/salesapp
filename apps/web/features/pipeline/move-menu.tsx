'use client';

import { stageTone, type Stage } from '@vistar/shared';
import { ArrowRightLeft, Check } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { STAGE_DOT } from './tones';

/**
 * "Move to stage..." menu: the non-drag alternative for every card (keyboard, touch, switch
 * access). Picking a stage moves the card to the top of that column.
 */
export function MoveMenu({
  leadName,
  stageId,
  stages,
  touch,
  onMove,
}: {
  leadName: string;
  stageId: string;
  stages: readonly Stage[];
  touch: boolean;
  onMove: (stageId: string) => void;
}) {
  // The card is re-mounted in its new column and takes focus; do not send focus back to this trigger.
  const moved = useRef(false);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button size={touch ? 'icon-touch' : 'icon-sm'} variant="ghost" aria-label={`Move ${leadName} to stage`} title="Move to stage…">
          <ArrowRightLeft aria-hidden />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 min-w-52 rounded-md border border-border bg-surface p-1 text-fg shadow-overlay data-[state=open]:animate-fade-in"
          onCloseAutoFocus={(e) => {
            if (moved.current) e.preventDefault();
            moved.current = false;
          }}
        >
          <DropdownMenu.Label className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted">Move to stage</DropdownMenu.Label>
          {stages.map((s) => {
            const current = s.id === stageId;
            return (
              <DropdownMenu.Item
                key={s.id}
                disabled={current}
                onSelect={() => {
                  moved.current = true;
                  onMove(s.id);
                }}
                className={cn(
                  'flex cursor-default items-center gap-2 rounded-sm px-2 text-sm outline-none select-none',
                  touch ? 'min-h-11' : 'min-h-8',
                  'data-[highlighted]:bg-surface-3 data-[disabled]:text-muted',
                )}
              >
                <span aria-hidden className={cn('size-2 shrink-0 rounded-full', STAGE_DOT[stageTone(s)])} />
                <span className="flex-1 truncate">{s.name}</span>
                {current && (
                  <span className="flex items-center gap-1 text-xs">
                    <Check aria-hidden className="size-3.5" />
                    Current
                  </span>
                )}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
