'use client';

import { EMPLOYEE_STATUS_LABEL, formatDuration, ROLE_KIND_LABELS, type AttentionItem, type ChipTone } from '@vistar/shared';
import { ArrowRightLeft, ExternalLink, MessageSquare, Phone, PlayCircle, X } from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/ui/chip';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { useNow } from '../state/env';
import { firstName } from '../state/reducer';
import { LOCATION_LABEL } from '../state/selectors';
import type { FloorEmployee, FloorLocation } from '../state/types';
import { NeedsYouItem } from './needs-you-list';
import { durationLabel, timeAgo } from './time';

export interface EmployeePanelProps {
  employee: FloorEmployee;
  location: FloorLocation;
  attention: AttentionItem[];
  /** Other people on the floor (reassign targets). */
  teammates: FloorEmployee[];
  readOnly: boolean;
  canReassign: boolean;
  canRecordings: boolean;
  onClose: () => void;
  onResolve: (item: AttentionItem) => void;
  onReassign: (toUserId: string) => void;
  onMessage: (text: string) => void;
  /** Rendered inside a dialog (mobile): no own close button or card chrome. */
  embedded?: boolean;
}

const TONE_DOT: Record<ChipTone, string> = {
  neutral: 'bg-muted',
  indigo: 'bg-status-indigo-fg',
  blue: 'bg-status-blue-fg',
  green: 'bg-status-green-fg',
  amber: 'bg-status-amber-fg',
  grey: 'bg-status-grey-fg',
  red: 'bg-status-red-fg',
};

export function TargetRing({ pct }: { pct: number | null }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const value = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className="relative size-14 shrink-0">
      <svg viewBox="0 0 56 56" className="size-14 -rotate-90" aria-hidden>
        <circle cx="28" cy="28" r={r} fill="none" strokeWidth="6" className="stroke-surface-3" />
        {pct !== null && (
          <circle
            cx="28"
            cy="28"
            r={r}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${(value / 100) * c} ${c}`}
            className={cn('transition-[stroke-dasharray] duration-250 ease-standard', pct >= 100 ? 'stroke-success' : 'stroke-accent')}
          />
        )}
      </svg>
      <span className="tabular absolute inset-0 flex items-center justify-center text-xs font-semibold text-fg">{pct === null ? '—' : `${Math.round(pct)}%`}</span>
    </div>
  );
}

export function EmployeePanel(props: EmployeePanelProps) {
  const { employee: e, location, attention, readOnly, canReassign, canRecordings, onClose, onResolve, embedded } = props;
  const now = useNow();
  const titleId = useId();
  const [dialog, setDialog] = useState<'reassign' | 'message' | null>(null);
  const onCall = e.status === 'on_call' && e.activeCall;

  return (
    <section
      aria-labelledby={titleId}
      className={cn('flex min-h-0 flex-col', !embedded && 'rounded-lg border border-border bg-surface shadow-card')}
      onKeyDown={(ev) => {
        if (ev.key === 'Escape' && !embedded) {
          ev.stopPropagation();
          onClose();
        }
      }}
    >
      <header className={cn('flex items-start gap-3 border-b border-border', embedded ? 'px-5 pt-5 pr-12 pb-4' : 'px-4 py-3')}>
        <Avatar name={e.name} size="lg" status={e.status} />
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="truncate text-base font-semibold text-fg">
            {e.name}
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span>{ROLE_KIND_LABELS[e.role]}</span>
            <StatusChip status={e.status} />
          </p>
        </div>
        {!embedded && (
          <Button size="icon-sm" variant="ghost" aria-label="Close employee details" onClick={onClose}>
            <X aria-hidden />
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="space-y-1">
          <p className="text-xs text-muted">Live status</p>
          {onCall ? (
            <p className="flex items-center gap-1.5 text-sm text-fg">
              <Phone aria-hidden className="size-4 text-status-blue-fg" />
              On a call{e.activeCall?.leadName ? ` with ${e.activeCall.leadName}` : ''}
              <span className="tabular ml-auto font-medium">{now ? formatDuration((now - (e.activeCall?.startedAt ?? now)) / 1000) : ''}</span>
            </p>
          ) : (
            <p className="text-sm text-fg">
              {EMPLOYEE_STATUS_LABEL[e.status]}
              {e.statusSince && now ? <span className="text-muted"> for {durationLabel(now - e.statusSince)}</span> : null}
            </p>
          )}
          <p className="text-xs text-muted">{LOCATION_LABEL[location.kind]}</p>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted">Current lead</p>
          {e.currentLeadName ? (
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-fg">{e.currentLeadName}</p>
              {e.currentLeadId && (
                <Button size="sm" variant="ghost" asChild>
                  <Link href={`/app/leads?lead=${e.currentLeadId}`}>
                    Open lead
                    <ExternalLink aria-hidden />
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">No lead open</p>
          )}
        </div>

        <dl className="grid grid-cols-[1fr_1fr_auto] items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
          <div>
            <dt className="text-xs text-muted">Calls today</dt>
            <dd className="tabular text-xl font-semibold text-fg">{e.callsToday}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Avg talk time</dt>
            <dd className="tabular text-xl font-semibold text-fg">{formatDuration(e.avgTalkSec)}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="sr-only">Monthly target</dt>
            <dd>
              <TargetRing pct={e.targetPct} />
            </dd>
          </div>
        </dl>

        {attention.length > 0 && (
          <div>
            <p className="text-xs text-muted">Needs you</p>
            <ul className="divide-y divide-border">
              {attention.map((item) => (
                <NeedsYouItem key={item.id} item={item} who={null} readOnly={readOnly} onResolve={onResolve} compact />
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="text-xs text-muted">Recent activity</p>
          {e.recent.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No activity since you opened the floor.</p>
          ) : (
            <ol className="mt-1 space-y-1.5">
              {e.recent.map((a) => (
                <li key={a.id} className="flex items-start gap-2 text-sm">
                  <span aria-hidden className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', TONE_DOT[a.tone])} />
                  <span className="min-w-0 flex-1 text-fg-secondary">{a.text}</span>
                  <span className="shrink-0 text-xs text-muted">{now ? timeAgo(a.at, now) : ''}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {!readOnly && (
        <footer className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
          {canReassign && (
            <Button size="sm" disabled={!e.currentLeadId} onClick={() => setDialog('reassign')} title={e.currentLeadId ? undefined : 'No lead to reassign'}>
              <ArrowRightLeft aria-hidden />
              Reassign lead
            </Button>
          )}
          <Button size="sm" onClick={() => setDialog('message')}>
            <MessageSquare aria-hidden />
            Message
          </Button>
          {canRecordings && (
            <Button size="sm" asChild>
              <Link href={`/app/calls?userId=${e.id}`}>
                <PlayCircle aria-hidden />
                View recordings
              </Link>
            </Button>
          )}
        </footer>
      )}

      {dialog === 'reassign' && (
        <ReassignDialog
          employee={e}
          teammates={props.teammates}
          onClose={() => setDialog(null)}
          onConfirm={(id) => {
            setDialog(null);
            props.onReassign(id);
          }}
        />
      )}
      {dialog === 'message' && (
        <MessageDialog
          employee={e}
          onClose={() => setDialog(null)}
          onSend={(text) => {
            setDialog(null);
            props.onMessage(text);
          }}
        />
      )}
    </section>
  );
}

function ReassignDialog({
  employee,
  teammates,
  onClose,
  onConfirm,
}: {
  employee: FloorEmployee;
  teammates: FloorEmployee[];
  onClose: () => void;
  onConfirm: (id: string) => void;
}) {
  const [to, setTo] = useState<string | null>(null);
  const options = teammates.filter((t) => t.id !== employee.id && t.status !== 'offline');
  const name = useId();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Reassign {employee.currentLeadName ?? 'lead'}</DialogTitle>
          <DialogDescription>Pick who takes it over. They see it on their desk right away.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {options.length === 0 ? (
            <p className="text-sm text-muted">Nobody else is in right now.</p>
          ) : (
            <fieldset className="space-y-1">
              <legend className="sr-only">New owner</legend>
              {options.map((t) => (
                <label
                  key={t.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-2 has-[:checked]:bg-accent-soft"
                >
                  <input type="radio" name={name} value={t.id} checked={to === t.id} onChange={() => setTo(t.id)} className="accent-accent" />
                  <Avatar name={t.name} size="sm" status={t.status} />
                  <span className="flex-1 truncate text-sm text-fg">{t.name}</span>
                  <span className="text-xs text-muted-strong">{EMPLOYEE_STATUS_LABEL[t.status]}</span>
                </label>
              ))}
            </fieldset>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!to} onClick={() => to && onConfirm(to)}>
            Reassign lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MessageDialog({ employee, onClose, onSend }: { employee: FloorEmployee; onClose: () => void; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Message {firstName(employee.name)}</DialogTitle>
          <DialogDescription>They get it as an in-app notification.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormField label="Message" hint={`${text.length}/500`}>
            <Textarea
              value={text}
              maxLength={500}
              rows={4}
              onChange={(ev) => setText(ev.target.value)}
              className="resize-none"
              placeholder="Call Rakesh back before 5 pm, he is ready to order."
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={() => onSend(text.trim())}>
            Send message
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
