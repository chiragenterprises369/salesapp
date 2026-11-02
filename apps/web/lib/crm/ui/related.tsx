'use client';

import { formatInr, formatPaise, type CrmRelated } from '@vistar/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan, useMe } from '@/lib/session/session';
import { DEAL_STATUS, formatDateTimeIn, formatDay, INVOICE_STATUS, MEETING_STATUS, QUOTATION_STATUS } from '../format';
import { DetailSection } from './detail-layout';

type Section = keyof CrmRelated;

const TITLES: Record<Section, string> = {
  contacts: 'Contacts',
  leads: 'Leads',
  deals: 'Deals',
  quotations: 'Quotations',
  invoices: 'Invoices',
  meetings: 'Meetings',
};

function Row({ href, title, meta, chip }: { href: string; title: string; meta?: ReactNode; chip?: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-2 py-2">
      <div className="min-w-0">
        <Link href={href} className="focus-ring block truncate rounded-sm text-sm font-medium text-fg hover:underline">
          {title}
        </Link>
        {meta && <p className="truncate text-xs text-muted-strong">{meta}</p>}
      </div>
      {chip}
    </li>
  );
}

/**
 * Related records of a contact, account or deal (GET /<entity>/{id}/related). Lists the caller may
 * not read come back empty from the API and are hidden here by permission.
 */
export function RelatedPanels({
  data,
  loading,
  error,
  onRetry,
  sections,
  actions = {},
}: {
  data: CrmRelated | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  sections: readonly Section[];
  actions?: Partial<Record<Section, ReactNode>>;
}) {
  const me = useMe();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const can = {
    contacts: useCan('contacts.read'),
    leads: useCan('leads.read'),
    deals: useCan('deals.read'),
    quotations: useCan('quotations.read'),
    invoices: useCan('invoices.read'),
    meetings: useCan('calendar.read'),
  };
  const visible = sections.filter((s) => can[s]);

  if (error) {
    return (
      <DetailSection title="Related records">
        <div role="alert" className="flex items-center justify-between gap-2 text-sm text-danger-text">
          Related records did not load.
          <button type="button" className="focus-ring rounded-sm font-medium underline" onClick={onRetry}>
            Try again
          </button>
        </div>
      </DetailSection>
    );
  }

  return (
    <>
      {visible.map((s) => {
        const list = data?.[s] ?? [];
        return (
          <DetailSection key={s} title={`${TITLES[s]}${data ? ` (${list.length})` : ''}`} actions={actions[s]}>
            {loading ? (
              <div className="flex flex-col gap-2" aria-label={`Loading ${TITLES[s].toLowerCase()}`}>
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-32" />
              </div>
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-strong">No {TITLES[s].toLowerCase()} yet.</p>
            ) : (
              <ul className="-my-2 divide-y divide-border">
                {s === 'contacts' &&
                  data!.contacts.map((c) => <Row key={c.id} href={`/app/contacts/${c.id}`} title={c.name} meta={[c.title, c.phone, c.email].filter(Boolean).join(' · ')} />)}
                {s === 'leads' &&
                  data!.leads.map((l) => <Row key={l.id} href={`/app/leads/${l.id}`} title={l.name} meta={[l.owner?.name, l.valueInr ? formatInr(l.valueInr) : null].filter(Boolean).join(' · ')} />)}
                {s === 'deals' &&
                  data!.deals.map((d) => (
                    <Row
                      key={d.id}
                      href={`/app/deals/${d.id}`}
                      title={d.title}
                      meta={[formatInr(d.valueInr), d.expectedCloseAt ? `closes ${formatDateTimeIn(d.expectedCloseAt, tz).split(',')[0]}` : null].filter(Boolean).join(' · ')}
                      chip={<Chip tone={DEAL_STATUS[d.status].tone}>{DEAL_STATUS[d.status].label}</Chip>}
                    />
                  ))}
                {s === 'quotations' &&
                  data!.quotations.map((q) => (
                    <Row key={q.id} href={`/app/quotations/${q.id}`} title={q.number} meta={`${formatPaise(q.totalPaise)} · ${formatDay(q.issueDate)}`} chip={<Chip tone={QUOTATION_STATUS[q.status].tone}>{QUOTATION_STATUS[q.status].label}</Chip>} />
                  ))}
                {s === 'invoices' &&
                  data!.invoices.map((i) => (
                    <Row
                      key={i.id}
                      href={`/app/invoices/${i.id}`}
                      title={i.number ?? 'Draft invoice'}
                      meta={`${formatPaise(i.totalPaise)}${i.balancePaise > 0 && i.status !== 'draft' && i.status !== 'cancelled' ? ` · ${formatPaise(i.balancePaise)} due` : ''}`}
                      chip={<Chip tone={i.overdue ? 'red' : INVOICE_STATUS[i.status].tone}>{i.overdue ? 'Overdue' : INVOICE_STATUS[i.status].label}</Chip>}
                    />
                  ))}
                {s === 'meetings' &&
                  data!.meetings.map((m) => (
                    <Row
                      key={`${m.id}-${m.occurrenceStart ?? ''}`}
                      href={`/app/calendar?meeting=${m.id}`}
                      title={m.title}
                      meta={formatDateTimeIn(m.startAt, tz)}
                      chip={m.status !== 'scheduled' ? <Chip tone={MEETING_STATUS[m.status].tone}>{MEETING_STATUS[m.status].label}</Chip> : undefined}
                    />
                  ))}
              </ul>
            )}
          </DetailSection>
        );
      })}
    </>
  );
}
