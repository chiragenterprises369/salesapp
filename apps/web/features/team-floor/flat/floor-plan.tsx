'use client';

import { type AttentionItem } from '@vistar/shared';
import { Headphones, Inbox } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useDocumentTheme } from '@/lib/use-document-theme';
import type { FloorTemplate } from '../state/template';
import type { FloorEmployee, FloorState } from '../state/types';
import { EmployeeList } from './employee-list';
import { FloorMap } from './floor-map';

/**
 * Flat view (SPEC 12.1 item 7), used on mobile, low-end devices and with reduced motion: the 2D plan
 * of the current template (same room colours, seat dots, status rings) and, below it, the
 * accessible desk list (one focusable button per person, arrow keys, unchanged). The plan is the
 * picture; the list is the keyboard and screen-reader path to the same information.
 */

export interface FloorPlanProps {
  state: FloorState;
  template: FloorTemplate;
  attention: Map<string, AttentionItem[]>;
  selectedId: string | null;
  onOpen: (id: string) => void;
  idPrefix: string;
  className?: string;
}

const LEGEND = [
  ['bg-status-blue-fg', 'On call'],
  ['bg-status-green-fg', 'Available'],
  ['bg-status-amber-fg', 'Busy'],
  ['bg-status-grey-fg', 'Break or offline'],
] as const;

export function FloorPlan({ state, template, attention, selectedId, onOpen, idPrefix, className }: FloorPlanProps) {
  const theme = useDocumentTheme();
  const byId = (id: string | null) => (id ? (state.employees[state.index[id] ?? -1] ?? null) : null);
  const inBooths = state.booths.map(byId).filter((e): e is FloorEmployee => !!e);
  const waiting = state.leadsWaiting.length + state.leadsWaitingExtra;

  return (
    <div className={cn('flex flex-col gap-3', className)} data-floor-flat={template.id}>
      <figure className="m-0 overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-3 py-2">
          <span className="text-xs font-semibold text-fg">{template.name}</span>
          <span className="flex items-center gap-1 text-xs text-muted">
            <Headphones aria-hidden className="size-3.5" />
            {inBooths.length}/{state.booths.length} booths in use
          </span>
          <span className="flex items-center gap-1 text-xs text-muted">
            <Inbox aria-hidden className="size-3.5" />
            {waiting === 0 ? 'No leads waiting' : `${waiting} ${waiting === 1 ? 'lead' : 'leads'} waiting at the Lead Hub`}
          </span>
          <ul aria-hidden className="ml-auto hidden gap-2 sm:flex">
            {LEGEND.map(([dot, label]) => (
              <li key={label} className="flex items-center gap-1 text-2xs text-muted">
                <span className={`size-1.5 rounded-full ${dot}`} />
                {label}
              </li>
            ))}
          </ul>
        </figcaption>
        <div className="p-2 sm:p-3">
          <FloorMap state={state} template={template} theme={theme} attention={attention} selectedId={selectedId} onOpen={onOpen} className="mx-auto max-h-[62dvh]" />
        </div>
      </figure>

      <section aria-label="Sales floor" className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
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
      </section>
    </div>
  );
}
