'use client';

import { formatInr, stageTone, type DealBoard, type DealListItem, type Stage } from '@vistar/shared';
import { CalendarClock, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useState, type DragEvent } from 'react';
import { COLUMN_TINT, COUNT_BORDER, STAGE_DOT } from '@/features/pipeline/tones';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/leads/primitives/menu';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useNow } from '@/components/common/use-now';
import { cn } from '@/lib/cn';
import { formatDateIn } from '@/lib/crm/format';
import { useReducedMotion } from '@/lib/use-reduced-motion';

export interface BoardMoveRequest {
  deal: DealListItem;
  stage: Stage;
  beforeDealId?: string | null;
  afterDealId?: string | null;
}

/**
 * Deals board: tinted stage columns (the Leads board tones), cards with value, account, owner and
 * close date. Drag a card to another column or position (mouse); every card also has a "Move to
 * stage" menu for keyboard, touch and screen reader use.
 */
export function DealsBoard({ board, loading, canMove, onMove, timeZone }: { board: DealBoard | undefined; loading: boolean; canMove: boolean; onMove: (req: BoardMoveRequest) => void; timeZone: string }) {
  const reduced = useReducedMotion();
  const now = useNow(60_000);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ stageId: string; index: number } | null>(null);

  if (loading && !board) {
    return (
      <div role="status" aria-label="Loading the deals board" className="flex gap-3 overflow-x-auto pb-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-border bg-surface-2 p-2">
            <Skeleton className="h-5 w-32" />
            {Array.from({ length: 3 }, (_, j) => (
              <Skeleton key={j} className="h-20 w-full rounded-md" />
            ))}
          </div>
        ))}
      </div>
    );
  }
  if (!board) return null;
  const all = new Map(board.columns.flatMap((c) => c.deals.map((d) => [d.id, d] as const)));

  const dropIndex = (e: DragEvent<HTMLElement>, list: HTMLElement): number => {
    const cards = [...list.querySelectorAll<HTMLElement>('[data-deal-card]')];
    const y = e.clientY;
    const at = cards.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return at === -1 ? cards.length : at;
  };

  return (
    <div className="flex min-h-[calc(100dvh-16rem)] gap-3 overflow-x-auto pb-2" role="list" aria-label="Deal stages">
      {board.columns.map((col) => {
        const tone = stageTone(col.stage);
        const isOver = over?.stageId === col.stage.id && dragId !== null;
        const visible = col.deals.filter((d) => d.id !== dragId || !isOver);
        return (
          <section
            key={col.stage.id}
            role="listitem"
            aria-label={`${col.stage.name}, ${col.count} ${col.count === 1 ? 'deal' : 'deals'}, ${formatInr(col.totalValueInr)}`}
            className={cn('flex w-72 shrink-0 flex-col rounded-lg border xl:w-80', COLUMN_TINT[tone], isOver && 'ring-2 ring-ring')}
            onDragOver={(e) => {
              if (!canMove || !dragId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const list = e.currentTarget.querySelector<HTMLElement>('[data-deal-list]');
              const index = list ? dropIndex(e, list) : 0;
              if (over?.stageId !== col.stage.id || over.index !== index) setOver({ stageId: col.stage.id, index });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o?.stageId === col.stage.id ? null : o));
            }}
            onDrop={(e) => {
              e.preventDefault();
              const deal = dragId ? all.get(dragId) : undefined;
              const index = over?.stageId === col.stage.id ? over.index : col.deals.length;
              setDragId(null);
              setOver(null);
              if (!deal) return;
              const others = col.deals.filter((d) => d.id !== deal.id);
              const before = others[index - 1]?.id ?? null;
              const after = others[index]?.id ?? null;
              if (deal.stageId === col.stage.id && col.deals.indexOf(deal) === index) return;
              onMove({ deal, stage: col.stage, beforeDealId: before, afterDealId: after });
            }}
          >
            <header data-slot="panel-head" className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-2">
              <div className="flex min-w-0 items-center gap-2">
                <span aria-hidden className={cn('size-2 shrink-0 rounded-full', STAGE_DOT[tone])} />
                <h3 className="truncate text-sm font-semibold text-fg">{col.stage.name}</h3>
                <span className={cn('inline-flex shrink-0 rounded-full border bg-surface px-1.5 text-2xs leading-4 font-semibold text-fg-secondary tabular-nums', COUNT_BORDER[tone])}>{col.count}</span>
              </div>
              <span className="text-xs text-muted-strong tabular-nums" title={`Weighted ${formatInr(col.weightedValueInr)}`}>
                {formatInr(col.totalValueInr, { compact: true })}
              </span>
            </header>
            <ol data-deal-list className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {visible.map((d, i) => (
                <li key={d.id}>
                  {isOver && over?.index === i && <DropMarker />}
                  <DealCard
                    deal={d}
                    stages={board.pipeline.stages}
                    canMove={canMove}
                    dragging={dragId === d.id}
                    reduced={reduced}
                    timeZone={timeZone}
                    now={now}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', d.id);
                      setDragId(d.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOver(null);
                    }}
                    onMoveTo={(stage) => onMove({ deal: d, stage })}
                  />
                </li>
              ))}
              {isOver && over && over.index >= visible.length && <DropMarker />}
              {col.deals.length === 0 && !isOver && <li className="rounded-md border border-dashed border-border-strong px-3 py-4 text-center text-xs text-muted-strong">No deals in this stage</li>}
              {col.nextCursor && <li className="px-1 text-center text-xs text-muted-strong">+{col.count - col.deals.length} more in the table view</li>}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function DropMarker() {
  return <div aria-hidden className="mb-2 h-1 rounded-full bg-accent" />;
}

function DealCard({
  deal,
  stages,
  canMove,
  dragging,
  reduced,
  timeZone,
  now,
  onDragStart,
  onDragEnd,
  onMoveTo,
}: {
  now: number;
  deal: DealListItem;
  stages: readonly Stage[];
  canMove: boolean;
  dragging: boolean;
  reduced: boolean;
  timeZone: string;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onMoveTo: (stage: Stage) => void;
}) {
  const overdue = deal.status === 'open' && !!deal.expectedCloseAt && now > 0 && new Date(deal.expectedCloseAt).getTime() < now - 86_400_000;
  return (
    <div
      data-deal-card
      draggable={canMove}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'group relative rounded-md border border-border bg-surface p-2.5 shadow-card',
        !reduced && 'transition-shadow duration-150 hover:shadow-raised',
        canMove && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/app/deals/${deal.id}`} className="focus-ring min-w-0 rounded-sm text-sm font-medium text-fg hover:underline">
          <span className="line-clamp-2">{deal.title}</span>
        </Link>
        {canMove && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={`Move ${deal.title} to another stage`} className="-mt-1 -mr-1 shrink-0">
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Move to stage</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {stages.map((s) => (
                <DropdownMenuItem key={s.id} disabled={s.id === deal.stageId} onSelect={() => onMoveTo(s)}>
                  {s.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {(deal.account || deal.contact) && <p className="mt-0.5 truncate text-xs text-muted-strong">{deal.account?.name ?? deal.contact?.name}</p>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-fg tabular-nums">{formatInr(deal.valueInr)}</span>
        <span className="flex items-center gap-1.5">
          {deal.expectedCloseAt && (
            <span className={cn('inline-flex items-center gap-1 text-2xs', overdue ? 'text-danger-text' : 'text-muted-strong')}>
              <CalendarClock aria-hidden className="size-3" />
              {formatDateIn(deal.expectedCloseAt, timeZone).replace(/ \d{4}$/, '')}
              {overdue && <span className="sr-only">(past the expected close date)</span>}
            </span>
          )}
          {deal.owner ? <Avatar name={deal.owner.name} size="xs" /> : <span className="text-2xs text-muted-strong">Unassigned</span>}
        </span>
      </div>
      <p className="mt-1 text-2xs text-muted-strong">
        {deal.probability}% · weighted {formatInr(deal.weightedValueInr, { compact: true })}
      </p>
    </div>
  );
}
