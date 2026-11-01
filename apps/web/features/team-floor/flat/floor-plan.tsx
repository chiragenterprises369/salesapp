'use client';

import { formatDuration, initials, type AttentionItem } from '@vistar/shared';
import { Coffee, Headphones, Inbox, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useNow } from '../state/env';
import { firstName } from '../state/reducer';
import type { FloorEmployee, FloorState } from '../state/types';
import { EmployeeList } from './employee-list';

/**
 * Flat floor plan: the same rooms as the 3D office as a CSS grid. The sales floor holds the
 * accessible desk list (one focusable button per person, stable position); the other rooms mirror
 * who is where (decorative, the desk list already says it).
 */

export interface FloorPlanProps {
  state: FloorState;
  attention: Map<string, AttentionItem[]>;
  selectedId: string | null;
  onOpen: (id: string) => void;
  idPrefix: string;
  className?: string;
}

function Room({
  title,
  icon,
  meta,
  tone,
  children,
  className,
  decorative,
}: {
  title: string;
  icon: ReactNode;
  meta?: ReactNode;
  tone: 'blue' | 'green' | 'indigo' | 'neutral';
  children: ReactNode;
  className?: string;
  decorative?: boolean;
}) {
  const tones = {
    blue: 'border-status-blue-border bg-status-blue-bg',
    green: 'border-status-green-border bg-status-green-bg',
    indigo: 'border-status-indigo-border bg-status-indigo-bg',
    neutral: 'border-border bg-surface-2',
  } as const;
  return (
    <section aria-label={decorative ? undefined : title} aria-hidden={decorative || undefined} className={cn('flex min-w-0 flex-col gap-2 rounded-lg border p-3', tones[tone], className)}>
      <header className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-strong uppercase">
        {icon}
        <span className="flex-1">{title}</span>
        {meta && <span className="font-medium tracking-normal normal-case">{meta}</span>}
      </header>
      {children}
    </section>
  );
}

function Occupant({ emp, now }: { emp: FloorEmployee; now: number }) {
  const timer = emp.status === 'on_call' && emp.activeCall && now ? formatDuration((now - emp.activeCall.startedAt) / 1000) : null;
  return (
    <li className="flex items-center gap-1.5 rounded-full border border-border bg-surface py-0.5 pr-2 pl-0.5 text-xs text-fg">
      <span className="inline-flex size-5 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent-soft-fg">{initials(emp.name)}</span>
      {firstName(emp.name)}
      {timer && <span className="tabular text-muted">{timer}</span>}
    </li>
  );
}

export function FloorPlan({ state, attention, selectedId, onOpen, idPrefix, className }: FloorPlanProps) {
  const now = useNow();
  const byId = (id: string | null) => (id ? (state.employees[state.index[id] ?? -1] ?? null) : null);
  const inBooths = state.booths.map(byId).filter((e): e is FloorEmployee => !!e);
  const inLounge = state.lounge.map(byId).filter((e): e is FloorEmployee => !!e);
  const cabinItems = attention.get('') ?? [];
  const waiting = state.leadsWaiting.length + state.leadsWaitingExtra;

  return (
    <div className={cn('grid gap-3 lg:grid-cols-[minmax(150px,1fr)_minmax(0,3.2fr)_minmax(150px,1fr)] lg:grid-rows-[auto_1fr]', className)}>
      <Room title="Manager cabin" icon={<UserRound aria-hidden className="size-3.5" />} tone="indigo" decorative className="order-4 lg:order-none">
        {cabinItems.length ? (
          <ul className="space-y-1">
            {cabinItems.slice(0, 3).map((i) => (
              <li key={i.id} className="truncate rounded-md border border-status-red-border bg-surface px-2 py-1 text-xs text-fg">
                <span className="mr-1 font-semibold text-status-red-fg">!</span>
                {i.title}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-strong">No team items need you.</p>
        )}
      </Room>

      <Room
        title="Sales floor"
        icon={<Inbox aria-hidden className="size-3.5" />}
        tone="neutral"
        className="order-1 lg:order-none lg:row-span-2"
        meta={`${state.employees.length} desks`}
      >
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-status-indigo-border bg-accent-soft px-3 py-2">
          <span className="text-xs font-semibold text-accent-soft-fg">Lead Hub</span>
          <span className="text-xs text-muted-strong">{waiting === 0 ? 'No leads waiting' : `${waiting} ${waiting === 1 ? 'lead' : 'leads'} waiting`}</span>
          <ul aria-label="Leads waiting" className="flex min-w-0 flex-wrap gap-1">
            {state.leadsWaiting.slice(-6).map((l) => (
              <li key={l.leadId} className="rounded-full border border-status-indigo-border bg-surface px-2 py-0.5 text-2xs text-fg motion-safe:animate-row-in">
                {l.name}
              </li>
            ))}
          </ul>
        </div>
        <EmployeeList state={state} attention={attention} selectedId={selectedId} onOpen={onOpen} variant="plan" idPrefix={idPrefix} />
      </Room>

      <Room
        title="Calling room"
        icon={<Headphones aria-hidden className="size-3.5" />}
        tone="blue"
        decorative
        className="order-2 lg:order-none lg:row-span-2"
        meta={`${inBooths.length}/${state.booths.length} booths`}
      >
        {inBooths.length ? (
          <ul className="flex flex-wrap gap-1">
            {inBooths.map((e) => (
              <Occupant key={e.id} emp={e} now={now} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-strong">No calls right now.</p>
        )}
      </Room>

      <Room title="Lounge" icon={<Coffee aria-hidden className="size-3.5" />} tone="green" decorative className="order-3 lg:order-none" meta={inLounge.length ? `${inLounge.length} on break` : undefined}>
        {inLounge.length ? (
          <ul className="flex flex-wrap gap-1">
            {inLounge.map((e) => (
              <Occupant key={e.id} emp={e} now={now} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-strong">Nobody on a break.</p>
        )}
      </Room>
    </div>
  );
}
