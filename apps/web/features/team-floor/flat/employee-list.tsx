'use client';

import { EMPLOYEE_STATUS_LABEL, formatDuration, type AttentionItem, type CallOutcome } from '@vistar/shared';
import { MapPin, Phone } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Chip, StatusChip } from '@/components/ui/chip';
import { cn } from '@/lib/cn';
import { useNow } from '../state/env';
import { OUTCOME_LABEL, OUTCOME_TONE } from '../state/reducer';
import { LOCATION_LABEL, locationOf } from '../state/selectors';
import type { FloorEmployee, FloorLocation, FloorState } from '../state/types';

/**
 * Accessible employee list. Always rendered: as the desk grid inside the flat floor plan
 * (`variant="plan"`), or visually hidden next to the 3D canvas (`variant="hidden"`, shown as an
 * overlay while it has keyboard focus). One tab stop; arrow keys move between people.
 * Rows are memoised: an event re-renders only the people it changed.
 */

export interface EmployeeListProps {
  state: FloorState;
  attention: Map<string, AttentionItem[]>;
  selectedId: string | null;
  onOpen: (id: string) => void;
  variant: 'plan' | 'hidden';
  idPrefix: string;
}

export function employeeDomId(prefix: string, id: string) {
  return `${prefix}-emp-${id}`;
}

const NO_ITEMS: AttentionItem[] = [];
const OUTCOME_SHOW_MS = 3500;

export function EmployeeList({ state, attention, selectedId, onOpen, variant, idPrefix }: EmployeeListProps) {
  const now = useNow();
  const listRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  const people = [...state.employees].sort((a, b) => a.desk - b.desk);
  const peopleRef = useRef(people);
  useEffect(() => {
    peopleRef.current = people;
  });
  const activeIndex = Math.min(active, Math.max(0, people.length - 1));

  const outcomes = new Map<string, CallOutcome>();
  for (const e of state.effects) {
    if (e.kind === 'call_outcome' && e.outcome && now - e.at < OUTCOME_SHOW_MS) outcomes.set(e.userId, e.outcome);
  }

  const onItemKey = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
      const list = listRef.current;
      const all = peopleRef.current;
      if (!list) return;
      let cols = 1;
      if (variant === 'plan') {
        const template = getComputedStyle(list).gridTemplateColumns;
        cols = Math.max(1, template.split(' ').filter(Boolean).length);
      }
      const map: Record<string, number> = {
        ArrowRight: index + 1,
        ArrowLeft: index - 1,
        ArrowDown: index + cols,
        ArrowUp: index - cols,
        Home: 0,
        End: all.length - 1,
      };
      const next = map[e.key];
      if (next === undefined) return;
      e.preventDefault();
      const clamped = Math.max(0, Math.min(all.length - 1, next));
      setActive(clamped);
      const target = all[clamped];
      if (target) document.getElementById(employeeDomId(idPrefix, target.id))?.focus();
    },
    [variant, idPrefix],
  );
  const onItemFocus = useCallback((index: number) => setActive(index), []);

  const hidden = variant === 'hidden';

  return (
    <div
      className={cn(
        hidden &&
          'sr-only focus-within:not-sr-only focus-within:absolute focus-within:inset-x-3 focus-within:top-3 focus-within:z-20 focus-within:max-h-[calc(100%-4.5rem)] focus-within:overflow-y-auto focus-within:rounded-lg focus-within:border focus-within:border-border focus-within:bg-surface focus-within:p-2 focus-within:shadow-overlay',
      )}
    >
      <h3 className={cn(hidden ? 'px-2 pt-1 pb-2 text-sm font-semibold text-fg' : 'sr-only')}>Employees on the floor ({people.length})</h3>
      <p id={`${idPrefix}-list-hint`} className="sr-only">
        Use the arrow keys to move between people and Enter to open details.
      </p>
      <ul
        ref={listRef}
        aria-describedby={`${idPrefix}-list-hint`}
        className={cn(variant === 'plan' ? 'grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-2' : 'flex flex-col gap-0.5')}
      >
        {people.map((emp, i) => (
          <li key={emp.id}>
            <PersonButton
              emp={emp}
              index={i}
              location={locationOf(state, emp).kind}
              items={attention.get(emp.id) ?? NO_ITEMS}
              now={emp.status === 'on_call' ? now : 0}
              outcome={outcomes.get(emp.id) ?? null}
              selected={emp.id === selectedId}
              compact={hidden}
              tabbable={i === activeIndex}
              domId={employeeDomId(idPrefix, emp.id)}
              onItemFocus={onItemFocus}
              onItemKey={onItemKey}
              onOpen={onOpen}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

interface PersonButtonProps {
  emp: FloorEmployee;
  index: number;
  location: FloorLocation['kind'];
  items: AttentionItem[];
  /** Clock for the call timer (0 unless on a call, so other rows skip the 1 s re-render). */
  now: number;
  outcome: CallOutcome | null;
  selected: boolean;
  compact: boolean;
  tabbable: boolean;
  domId: string;
  onItemFocus: (index: number) => void;
  onItemKey: (e: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  onOpen: (id: string) => void;
}

const PersonButton = memo(function PersonButton({
  emp,
  index,
  location,
  items,
  now,
  outcome,
  selected,
  compact,
  tabbable,
  domId,
  onItemFocus,
  onItemKey,
  onOpen,
}: PersonButtonProps) {
  const away = location !== 'desk';
  const timer = emp.status === 'on_call' && emp.activeCall && now ? formatDuration((now - emp.activeCall.startedAt) / 1000) : null;
  const urgent = items.some((i) => i.severity === 'critical');
  const common = {
    id: domId,
    type: 'button' as const,
    tabIndex: tabbable ? 0 : -1,
    'aria-current': selected || undefined,
    onFocus: () => onItemFocus(index),
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => onItemKey(e, index),
    onClick: () => onOpen(emp.id),
  };

  if (compact) {
    return (
      <button {...common} className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2 aria-[current]:bg-accent-soft">
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{emp.name}</span>
        <span className="text-xs text-muted-strong">
          {EMPLOYEE_STATUS_LABEL[emp.status]}
          {timer ? `, ${timer}` : ''}
          {emp.currentLeadName ? `, ${emp.currentLeadName}` : ''}
          {away ? `, ${LOCATION_LABEL[location].toLowerCase()}` : ''}
          {items.length ? `, ${items.length} ${items.length === 1 ? 'item needs' : 'items need'} you` : ''}
        </span>
      </button>
    );
  }

  return (
    <button
      {...common}
      className={cn(
        'focus-ring relative flex h-full w-full flex-col gap-1.5 rounded-md border bg-surface p-2.5 text-left shadow-card transition-[border-color,box-shadow,background-color] duration-150 ease-standard hover:border-border-strong hover:shadow-raised',
        selected ? 'border-ring bg-accent-soft' : 'border-border',
        emp.status === 'offline' && !selected && 'border-dashed bg-surface-2 shadow-none',
      )}
    >
      <span className="flex items-center gap-2">
        <Avatar name={emp.name} size="sm" status={emp.status} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{emp.name}</span>
        {items.length > 0 && (
          <Chip tone={urgent ? 'red' : 'amber'} className="tabular">
            <span aria-hidden>!</span>
            {items.length}
            <span className="sr-only">{items.length === 1 ? ' item needs you' : ' items need you'}</span>
          </Chip>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-1">
        <StatusChip status={emp.status} />
        {timer && (
          <span className="tabular inline-flex items-center gap-1 text-xs text-status-blue-fg">
            <Phone aria-hidden className="size-3" />
            {timer}
          </span>
        )}
        {outcome && (
          <Chip tone={OUTCOME_TONE[outcome]} className="motion-safe:animate-fade-in">
            {OUTCOME_LABEL[outcome]}
          </Chip>
        )}
      </span>
      <span className="truncate text-xs text-muted">{emp.currentLeadName ?? (emp.status === 'offline' ? 'Desk empty' : 'No lead open')}</span>
      {away && location !== 'gone' && (
        <span className="flex items-center gap-1 text-xs text-muted">
          <MapPin aria-hidden className="size-3" />
          {LOCATION_LABEL[location]}
        </span>
      )}
    </button>
  );
});
