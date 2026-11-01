'use client';

import { formatInr, type LeadListItem } from '@vistar/shared';
import { AlarmClock, Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { LeadQuickActions, useLeadActions } from '@/components/leads-shared/lead-actions';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useLeadsViewState } from '@/lib/leads/state';
import { useCan } from '@/lib/session/session';
import {
  formatCreated,
  formatFollowUp,
  formatPhone,
  isOverdue,
  SourceChip,
  TagList,
  TemperatureChip,
} from './lead-meta';
import { Checkbox } from './primitives/checkbox';
import { StageSelect } from './stage-select';
import { EmptyState, ErrorState, NoLeadsYet } from './states';
import { useRecentLeads } from './stores';
import { useTableRows } from './use-table-rows';

/** Table view below 768px: the same fields as cards, 44px touch quick actions. */
export function LeadCardList({ onCreate }: { onCreate?: () => void }) {
  const { query, rows, total, hasFilters } = useTableRows();
  const canBulk = useCan('leads.bulk');
  const canCreate = useCan('leads.create');
  const resetFilters = useLeadsViewState((s) => s.resetFilters);
  const selectedIds = useLeadsViewState((s) => s.selectedIds);
  const toggleSelected = useLeadsViewState((s) => s.toggleSelected);
  const recent = useRecentLeads((s) => s.ids);
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (query.isPending) {
    return (
      <ul aria-busy="true" aria-label="Loading leads" className="flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className="rounded-lg border border-border bg-surface p-3">
            <Skeleton className="mb-2 h-4 w-40" />
            <Skeleton className="mb-3 h-3 w-28" />
            <Skeleton className="h-5 w-48" />
          </li>
        ))}
      </ul>
    );
  }
  if (query.isError && rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <ErrorState onRetry={() => void query.refetch()} retrying={query.isRefetching} />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        {hasFilters ? (
          <EmptyState
            title="No leads match these filters"
            description="Try a wider date range or fewer filters."
            action={<Button onClick={resetFilters}>Clear filters</Button>}
          />
        ) : (
          <NoLeadsYet
            action={
              canCreate && onCreate ? <Button onClick={onCreate}>New lead</Button> : undefined
            }
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-2 transition-opacity duration-150',
        query.isPlaceholderData && 'opacity-60',
      )}
    >
      <ul aria-label={`Leads, ${total} total`} className="flex flex-col gap-2">
        {rows.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            selectable={canBulk}
            selected={selectedIds.has(lead.id)}
            isNew={recent.has(lead.id)}
            onToggle={() => toggleSelected(lead.id)}
          />
        ))}
      </ul>
      <div
        ref={sentinel}
        className="flex min-h-11 items-center justify-center text-xs text-muted-strong"
      >
        {isFetchingNextPage ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
            Loading more leads…
          </span>
        ) : hasNextPage ? (
          <Button size="touch" variant="ghost" onClick={() => void fetchNextPage()}>
            Show more ({rows.length} of {total})
          </Button>
        ) : (
          `All ${total} leads loaded`
        )}
      </div>
      {selectedIds.size > 0 && <div aria-hidden className="h-24" />}
    </div>
  );
}

function LeadCard({
  lead,
  selectable,
  selected,
  isNew,
  onToggle,
}: {
  lead: LeadListItem;
  selectable: boolean;
  selected: boolean;
  isNew: boolean;
  onToggle: () => void;
}) {
  const actions = useLeadActions();
  const overdue = isOverdue(lead.nextFollowUpAt);
  const muted = selected ? 'text-muted-strong' : 'text-muted';
  return (
    <li
      data-new={isNew ? 'true' : undefined}
      onClick={() => actions.open(lead)}
      className={cn(
        'flex cursor-pointer flex-col gap-2.5 rounded-lg border bg-surface p-3 shadow-card transition-colors duration-150 data-[new=true]:animate-row-in',
        selected ? 'border-status-indigo-border bg-accent-soft' : 'border-border',
      )}
    >
      <div className="flex items-start gap-3">
        {selectable && (
          <span
            className="-m-3 flex size-11 shrink-0 items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={selected}
              onCheckedChange={onToggle}
              aria-label={`Select ${lead.name}`}
              className="size-5"
            />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              actions.open(lead);
            }}
            className="focus-ring block max-w-full truncate rounded-xs text-left text-sm font-semibold text-fg"
          >
            {lead.name}
          </button>
          <p className={cn('truncate text-xs', muted)}>
            {[lead.companyName, lead.city].filter(Boolean).join(' · ') || 'No company'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="tabular text-sm font-semibold">
            {formatInr(lead.valueInr, { compact: true })}
          </p>
          <p className={cn('tabular text-2xs', muted)}>Score {lead.score}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <StageSelect lead={lead} />
        <SourceChip source={lead.source} />
        <TemperatureChip temperature={lead.temperature} />
        {lead.tags.length > 0 && <TagList tags={lead.tags} max={1} />}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <div className="flex min-w-0 items-center gap-1.5">
          <dt className="sr-only">Owner</dt>
          <dd className="flex min-w-0 items-center gap-1.5 text-fg-secondary">
            {lead.owner ? (
              <>
                <Avatar name={lead.owner.name} size="xs" aria-hidden />
                <span className="truncate">{lead.owner.name}</span>
              </>
            ) : (
              <span className={muted}>Unassigned</span>
            )}
          </dd>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-1">
          <dt className="sr-only">Next follow-up</dt>
          <dd
            className={cn(
              'inline-flex items-center gap-1 truncate',
              overdue ? 'font-medium text-danger-text' : 'text-fg-secondary',
            )}
          >
            {overdue && <AlarmClock aria-hidden className="size-3.5" />}
            {overdue && <span className="sr-only">Overdue: </span>}
            {lead.nextFollowUpAt ? formatFollowUp(lead.nextFollowUpAt) : 'No follow-up'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="sr-only">Phone</dt>
          <dd className="tabular truncate text-fg-secondary">{formatPhone(lead.phone)}</dd>
        </div>
        <div className="min-w-0 text-right">
          <dt className="sr-only">Created</dt>
          <dd className={cn('truncate', muted)}>Created {formatCreated(lead.createdAt)}</dd>
        </div>
      </dl>
      <div className="-mx-1 -mb-1 flex justify-end border-t border-border pt-1">
        <LeadQuickActions lead={lead} size="touch" />
      </div>
    </li>
  );
}
