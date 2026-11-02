'use client';

import type { CrmTimelineItem } from '@vistar/shared';
import { CalendarDays, FileText, Handshake, IndianRupee, Merge, MessageSquare, ReceiptIndianRupee, StickyNote, Users } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useNow } from '@/components/common/use-now';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/input';
import { isApiRequestError } from '@/lib/api-error';
import { useMe } from '@/lib/session/session';
import { ago, formatDateTimeIn } from '../format';

const ICONS: Record<CrmTimelineItem['kind'], typeof StickyNote> = {
  note: StickyNote,
  lead_activity: MessageSquare,
  meeting: CalendarDays,
  quotation: FileText,
  invoice: ReceiptIndianRupee,
  payment: IndianRupee,
  deal: Handshake,
  merged: Merge,
};

const REF_PATH: Record<string, string> = {
  contact: '/app/contacts',
  account: '/app/accounts',
  deal: '/app/deals',
  lead: '/app/leads',
  quotation: '/app/quotations',
  invoice: '/app/invoices',
  meeting: '/app/calendar?meeting=',
};

export function refHref(ref: { type: string; id: string } | null): string | null {
  if (!ref) return null;
  const base = REF_PATH[ref.type];
  if (!base) return null;
  return base.endsWith('=') ? `${base}${ref.id}` : `${base}/${ref.id}`;
}

type TimelineQuery = {
  data?: { pages: Array<{ items: CrmTimelineItem[] }> };
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage: () => unknown;
};

/** Merged timeline of a contact, account or deal with a note composer. */
export function CrmTimeline({ query, canAddNote, onAddNote }: { query: TimelineQuery; canAddNote: boolean; onAddNote: (body: string) => Promise<unknown> }) {
  const me = useMe();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const now = useNow(60_000);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = note.trim();
    if (!body) return setError('Write a note first.');
    setSaving(true);
    setError(null);
    try {
      await onAddNote(body);
      setNote('');
    } catch (err) {
      setError(isApiRequestError(err) ? err.message : 'The note was not saved. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {canAddNote && (
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2" noValidate>
          <label htmlFor="crm-note" className="sr-only">
            Add a note
          </label>
          <Textarea
            id="crm-note"
            rows={2}
            value={note}
            placeholder="Add a note (visible to everyone who can see this record)"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'crm-note-error' : undefined}
            onChange={(e) => {
              setNote(e.target.value);
              setError(null);
            }}
          />
          {error && (
            <p id="crm-note-error" role="alert" className="text-xs text-danger-text">
              {error}
            </p>
          )}
          <Button type="submit" size="sm" className="self-end" loading={saving}>
            Add note
          </Button>
        </form>
      )}
      {query.isPending && (
        <ul aria-label="Loading timeline" className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="flex gap-3">
              <Skeleton className="size-7 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-48" />
                <Skeleton className="h-3 w-24" />
              </div>
            </li>
          ))}
        </ul>
      )}
      {query.isError && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-sm text-status-red-fg">
          The timeline did not load.
          <Button size="sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {!query.isPending && !query.isError && items.length === 0 && <p className="text-sm text-muted-strong">Nothing here yet. Notes, meetings, quotations, invoices and lead activity show up as they happen.</p>}
      {items.length > 0 && (
        <ol className="relative flex flex-col gap-4 before:absolute before:top-2 before:bottom-2 before:left-3.5 before:w-px before:bg-border" aria-label="Timeline">
          {items.map((it) => {
            const Icon = ICONS[it.kind] ?? Users;
            const href = refHref(it.ref);
            return (
              <li key={it.id} className="relative flex gap-3">
                <span aria-hidden className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted-strong">
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-sm text-fg">
                    {href ? (
                      <Link href={href} className="focus-ring rounded-sm font-medium hover:underline">
                        {it.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{it.title}</span>
                    )}
                  </p>
                  {it.body && <p className="mt-0.5 text-sm whitespace-pre-wrap text-fg-secondary">{it.body}</p>}
                  <p className="mt-0.5 text-xs text-muted-strong">
                    {it.actor ? `${it.actor.name} · ` : ''}
                    <time dateTime={it.at} title={formatDateTimeIn(it.at, tz)}>
                      {ago(it.at, now) || formatDateTimeIn(it.at, tz)}
                    </time>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {query.hasNextPage && (
        <Button size="sm" variant="ghost" className="self-center" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          Show older
        </Button>
      )}
    </div>
  );
}
