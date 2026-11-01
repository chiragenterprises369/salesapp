'use client';

import { stageTone, type LeadListItem } from '@vistar/shared';
import { MOCK_PIPELINE_ID } from '@vistar/shared/fixtures';
import { ChevronDown } from 'lucide-react';
import { chipVariants } from '@/components/ui/chip';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { useMoveLead } from '@/lib/leads/data';
import { useCan } from '@/lib/session/session';
import { STAGE_BY_ID, STAGES, StageChip, TONE_DOT_CLASS } from './lead-meta';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './primitives/menu';

/**
 * Inline stage dropdown (Table rows and mobile cards). Uses the shared optimistic `useMoveLead`
 * with no neighbours, so the lead lands at the end of the target Board column.
 */
export function StageSelect({
  lead,
  tabIndex,
  size = 'sm',
}: {
  lead: LeadListItem;
  tabIndex?: number;
  size?: 'sm' | 'md';
}) {
  const canUpdate = useCan('leads.update');
  const move = useMoveLead(MOCK_PIPELINE_ID);
  const stage = STAGE_BY_ID.get(lead.stageId);
  if (!canUpdate || !stage) return <StageChip stageId={lead.stageId} />;
  const tone = stageTone(stage);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        tabIndex={tabIndex}
        aria-label={`Stage: ${stage.name}. Change stage for ${lead.name}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className={cn(
          chipVariants({ tone, size }),
          'focus-ring cursor-pointer gap-1 transition-[filter] hover:brightness-95 dark:hover:brightness-125',
          size === 'md' && 'h-8 px-2.5 text-xs',
        )}
      >
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        {stage.name}
        <ChevronDown aria-hidden className="opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel>Move to stage</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={lead.stageId}
          onValueChange={(stageId) => {
            if (stageId === lead.stageId) return;
            const target = STAGE_BY_ID.get(stageId);
            move.mutate(
              { lead, move: { stageId } },
              {
                onSuccess: () => toast.success(`${lead.name} moved to ${target?.name ?? 'stage'}`),
              },
            );
          }}
        >
          {STAGES.map((s) => (
            <DropdownMenuRadioItem key={s.id} value={s.id}>
              <span
                aria-hidden
                className={cn('size-2 rounded-full', TONE_DOT_CLASS[stageTone(s)])}
              />
              {s.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
