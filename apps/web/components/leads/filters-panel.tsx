'use client';

import { LEAD_SOURCES, LEAD_TEMPERATURES, stageTone, type LeadFilters } from '@vistar/shared';
import { endOfDay, format, startOfDay } from 'date-fns';
import { SlidersHorizontal, X } from 'lucide-react';
import { motion } from 'motion/react';
import { Slider } from 'radix-ui';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { useLeadsViewState } from '@/lib/leads/state';
import { useMe } from '@/lib/session/session';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import {
  ACTIVE_FILTER_CLASS,
  useKnownTags,
  SOURCE_LABEL,
  TEMPERATURE_LABEL,
  TONE_DOT_CLASS,
  useScopedUsers,
} from './lead-meta';
import { usePipelineStages } from './use-stages';

/** Number of active filter groups (search excluded; it has its own field). */
export function countActiveFilters(f: LeadFilters): number {
  let n = 0;
  if (f.source?.length) n++;
  if (f.stageId?.length) n++;
  if (f.ownerId?.length) n++;
  if (f.tag?.length) n++;
  if (f.temperature?.length) n++;
  if (f.scoreMin !== undefined || f.scoreMax !== undefined) n++;
  if (f.createdFrom || f.createdTo) n++;
  return n;
}

export function FiltersButton() {
  const open = useLeadsViewState((s) => s.filtersPanelOpen);
  const setOpen = useLeadsViewState((s) => s.setFiltersPanelOpen);
  const count = useLeadsViewState((s) => countActiveFilters(s.filters));
  return (
    <Button
      aria-expanded={open}
      aria-controls="leads-filters-panel"
      onClick={() => setOpen(!open)}
      className={count > 0 ? ACTIVE_FILTER_CLASS : undefined}
    >
      <SlidersHorizontal aria-hidden />
      Filters
      {count > 0 && (
        <span className="tabular inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-2xs font-semibold text-accent-fg">
          {count}
          <span className="sr-only"> active</span>
        </span>
      )}
    </Button>
  );
}

function toggle<T>(list: readonly T[] | undefined, value: T): T[] | undefined {
  const next = list?.includes(value) ? list.filter((v) => v !== value) : [...(list ?? []), value];
  return next.length ? next : undefined;
}

function Group({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className={cn('flex min-w-0 flex-col gap-2', className)}>
      <span id={id} className="text-xs font-medium text-fg-secondary">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Toggle({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'focus-ring inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors duration-150 ease-standard',
        pressed
          ? 'border-status-indigo-border bg-accent-soft text-accent-soft-fg'
          : 'border-border bg-surface text-fg-secondary hover:bg-surface-2 hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

function ScoreRange() {
  const scoreMin = useLeadsViewState((s) => s.filters.scoreMin);
  const scoreMax = useLeadsViewState((s) => s.filters.scoreMax);
  const setFilters = useLeadsViewState((s) => s.setFilters);
  const external: [number, number] = [scoreMin ?? 0, scoreMax ?? 100];
  const [draft, setDraft] = useState<[number, number] | null>(null);
  const value = draft ?? external;
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <span
        id={id}
        className="flex items-center justify-between text-xs font-medium text-fg-secondary"
      >
        Score
        <span className="tabular text-muted">
          {value[0]}–{value[1]}
        </span>
      </span>
      <Slider.Root
        min={0}
        max={100}
        step={5}
        minStepsBetweenThumbs={1}
        value={value}
        onValueChange={(v) => setDraft([v[0] ?? 0, v[1] ?? 100])}
        onValueCommit={(v) => {
          setDraft(null);
          const [lo = 0, hi = 100] = v;
          setFilters({ scoreMin: lo > 0 ? lo : undefined, scoreMax: hi < 100 ? hi : undefined });
        }}
        className="relative flex h-7 w-full touch-none items-center select-none"
      >
        <Slider.Track className="relative h-1 grow rounded-full bg-surface-3">
          <Slider.Range className="absolute h-full rounded-full bg-accent" />
        </Slider.Track>
        {['Minimum score', 'Maximum score'].map((label) => (
          <Slider.Thumb
            key={label}
            aria-label={label}
            className="focus-ring block size-4 rounded-full border-2 border-accent bg-surface shadow-card transition-colors hover:bg-accent-soft"
          />
        ))}
      </Slider.Root>
    </div>
  );
}

function CreatedRange() {
  const createdFrom = useLeadsViewState((s) => s.filters.createdFrom);
  const createdTo = useLeadsViewState((s) => s.filters.createdTo);
  const setFilters = useLeadsViewState((s) => s.setFilters);
  const from = createdFrom ? format(new Date(createdFrom), 'yyyy-MM-dd') : '';
  const to = createdTo ? format(new Date(createdTo), 'yyyy-MM-dd') : '';
  return (
    <div className="grid grid-cols-2 gap-2">
      <FormField label="Created from">
        <Input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) =>
            setFilters({
              createdFrom: e.target.value
                ? startOfDay(new Date(`${e.target.value}T00:00:00`)).toISOString()
                : undefined,
            })
          }
        />
      </FormField>
      <FormField label="Created to">
        <Input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) =>
            setFilters({
              createdTo: e.target.value
                ? endOfDay(new Date(`${e.target.value}T00:00:00`)).toISOString()
                : undefined,
            })
          }
        />
      </FormField>
    </div>
  );
}

/**
 * Inline filter panel (open state is shared: `filtersPanelOpen`, so it survives Board <-> Table).
 * Every control writes the shared filters immediately; both views refetch with the same key.
 */
export function FiltersPanel() {
  const open = useLeadsViewState((s) => s.filtersPanelOpen);
  const setOpen = useLeadsViewState((s) => s.setFiltersPanelOpen);
  const filters = useLeadsViewState((s) => s.filters);
  const setFilters = useLeadsViewState((s) => s.setFilters);
  const resetFilters = useLeadsViewState((s) => s.resetFilters);
  const me = useMe();
  const users = useScopedUsers();
  const knownTags = useKnownTags();
  const reduced = useReducedMotion();
  const { stages } = usePipelineStages();
  if (!open) return null;

  const ownerOptions: Array<{ id: string; label: string }> = [
    { id: 'me', label: 'Me' },
    ...(me?.role.dataScope === 'own' ? [] : [{ id: 'unassigned', label: 'Unassigned' }]),
    ...users.filter((u) => u.id !== me?.user.id).map((u) => ({ id: u.id, label: u.name })),
  ];

  return (
    <motion.section
      id="leads-filters-panel"
      aria-label="Filters"
      initial={reduced ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
      className="rounded-lg border border-border bg-surface p-4 shadow-card"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Filters</h2>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={resetFilters}
            disabled={countActiveFilters(filters) === 0 && !filters.q}
          >
            Clear all
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Close filters"
            onClick={() => setOpen(false)}
          >
            <X aria-hidden />
          </Button>
        </div>
      </div>
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
        <Group label="Source">
          {LEAD_SOURCES.map((s) => (
            <Toggle
              key={s}
              pressed={!!filters.source?.includes(s)}
              onClick={() => setFilters({ source: toggle(filters.source, s) })}
            >
              {SOURCE_LABEL[s]}
            </Toggle>
          ))}
        </Group>
        <Group label="Stage">
          {stages.map((s) => (
            <Toggle
              key={s.id}
              pressed={!!filters.stageId?.includes(s.id)}
              onClick={() => setFilters({ stageId: toggle(filters.stageId, s.id) })}
            >
              <span
                aria-hidden
                className={cn('size-1.5 rounded-full', TONE_DOT_CLASS[stageTone(s)])}
              />
              {s.name}
            </Toggle>
          ))}
        </Group>
        {me?.role.dataScope !== 'own' && (
          <Group label="Owner">
            {ownerOptions.map((o) => (
              <Toggle
                key={o.id}
                pressed={!!filters.ownerId?.includes(o.id)}
                onClick={() => setFilters({ ownerId: toggle(filters.ownerId, o.id) })}
              >
                {o.label}
              </Toggle>
            ))}
          </Group>
        )}
        <Group label="Tags">
          {knownTags.map((t) => (
            <Toggle
              key={t}
              pressed={!!filters.tag?.includes(t)}
              onClick={() => setFilters({ tag: toggle(filters.tag, t) })}
            >
              {t}
            </Toggle>
          ))}
        </Group>
        <Group label="Temperature">
          {LEAD_TEMPERATURES.map((t) => (
            <Toggle
              key={t}
              pressed={!!filters.temperature?.includes(t)}
              onClick={() => setFilters({ temperature: toggle(filters.temperature, t) })}
            >
              {TEMPERATURE_LABEL[t]}
            </Toggle>
          ))}
        </Group>
        <div className="flex flex-col gap-4">
          <ScoreRange />
          <CreatedRange />
        </div>
      </div>
    </motion.section>
  );
}
