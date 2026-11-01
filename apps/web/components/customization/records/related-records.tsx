'use client';

import { useQuery } from '@tanstack/react-query';
import {
  fieldAccessFor,
  labelOf,
  objectTarget,
  parseTarget,
  type CustomObject,
  type FieldDefinition,
  type Lead,
  type LeadListItem,
} from '@vistar/shared';
import { Link2 } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useCustomObjects, useFieldDefinitions, useLabels, useRecords } from '@/lib/customization';
import { getLeadsSource } from '@/lib/leads/data';
import { useMe } from '@/lib/session/session';
import { configOf, relationTargetOf } from '../field-utils';
import { recordHref, useLeadHref } from '../relation-values';
import { ObjectIcon } from './record-meta';

const SHOWN = 10;

/**
 * Records that link TO this record: every active relation field (on other objects, this object, or
 * leads) whose target is this object, listed per field.
 */
export function RelatedRecords({ object, recordId }: { object: CustomObject; recordId: string }) {
  const me = useMe();
  const defs = useFieldDefinitions();
  const objects = useCustomObjects();
  const target = objectTarget(object.key);
  const sources = (defs.data ?? []).filter(
    (f) =>
      f.type === 'relation' &&
      !f.archivedAt &&
      relationTargetOf(f) === target &&
      fieldAccessFor(f, me?.role.key) !== 'hidden',
  );
  if (defs.isPending) return <Skeleton className="h-28 w-full rounded-lg" />;
  if (sources.length === 0) return null;
  return (
    <section aria-labelledby={`related-${recordId}`} className="flex flex-col gap-3">
      <h2 id={`related-${recordId}`} className="text-sm font-semibold text-fg">
        Linked records
      </h2>
      {sources.map((f) => {
        const t = parseTarget(f.target);
        if (t.kind === 'object') {
          const other = objects.data?.find((o) => o.key === t.key);
          if (objects.data && (!other || other.archivedAt)) return null;
          return (
            <RelatedObjectGroup
              key={f.id}
              field={f}
              objectKey={t.key}
              other={other}
              recordId={recordId}
            />
          );
        }
        if (t.entity === 'lead')
          return <RelatedLeadsGroup key={f.id} field={f} recordId={recordId} />;
        return null;
      })}
    </section>
  );
}

function GroupCard({
  title,
  via,
  icon,
  count,
  children,
}: {
  title: string;
  via: string;
  icon: ReactNode;
  count?: number;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-3 text-fg-secondary"
          >
            {icon}
          </span>
          <div className="min-w-0">
            <CardTitle className="truncate">
              {title}
              {count !== undefined && (
                <span className="tabular ml-1.5 font-normal text-muted">
                  {count.toLocaleString('en-IN')}
                </span>
              )}
            </CardTitle>
            <CardDescription className="truncate">Linked through {via}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-1">{children}</CardContent>
    </Card>
  );
}

const itemLink =
  'focus-ring flex min-h-11 items-center justify-between gap-2 rounded-md px-2 text-sm text-fg hover:bg-surface-2 sm:min-h-8';

function RelatedObjectGroup({
  field,
  objectKey,
  other,
  recordId,
}: {
  field: FieldDefinition;
  objectKey: string;
  other: CustomObject | undefined;
  recordId: string;
}) {
  const q = useRecords(objectKey, {
    related: `${field.key}:${recordId}`,
    limit: SHOWN,
    sort: 'updatedAt',
    dir: 'desc',
  });
  const title =
    configOf({ type: 'relation', config: field.config }).inverseLabel ??
    other?.labelPlural ??
    'Records';
  const total = q.data?.total;
  return (
    <GroupCard
      title={title}
      via={`${other?.labelSingular ?? 'Record'} › ${field.label}`}
      icon={<ObjectIcon name={other?.icon} className="size-3.5" />}
      count={total}
    >
      {q.isPending ? (
        <Skeleton className="h-8 w-full" />
      ) : q.isError ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          These did not load.
          <Button size="sm" variant="link" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </p>
      ) : q.data.items.length === 0 ? (
        <p className="px-2 py-1 text-sm text-muted">Nothing linked yet.</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {q.data.items.map((r) => (
            <li key={r.id}>
              <Link href={recordHref(objectKey, r.id)} className={itemLink}>
                <span className="truncate">{r.title || 'Untitled'}</span>
              </Link>
            </li>
          ))}
          {total !== undefined && total > q.data.items.length && (
            <li className="px-2 pt-1 text-xs text-muted">
              and {(total - q.data.items.length).toLocaleString('en-IN')} more
            </li>
          )}
        </ul>
      )}
    </GroupCard>
  );
}

/**
 * Leads whose relation field points at this record.
 * TEMP (Wave 1): the leads list has no reverse-relation filter yet, so this reads every lead the user
 * can see and checks `customFields`. Replace with `useLeadsList({ related: '<fieldKey>:<id>' })` once
 * LeadFilters gains `related` (CONTRACT-REQUEST in the stream R summary).
 */
function useLeadsLinkedTo(fieldKey: string, recordId: string) {
  return useQuery({
    queryKey: ['leads', 'related', fieldKey, recordId],
    queryFn: async (): Promise<LeadListItem[]> => {
      const src = getLeadsSource();
      const all: LeadListItem[] = [];
      let cursor: string | undefined;
      do {
        const page = await src.list({
          limit: 200,
          sort: 'createdAt',
          dir: 'desc',
          ...(cursor ? { cursor } : {}),
        });
        all.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor && all.length < 2000);
      const hits: LeadListItem[] = [];
      for (let i = 0; i < all.length; i += 50) {
        const details = await Promise.all(
          all.slice(i, i + 50).map((l) => src.get(l.id).catch(() => null as Lead | null)),
        );
        for (const d of details) {
          const v = d?.customFields[fieldKey];
          if (d && (v === recordId || (Array.isArray(v) && v.includes(recordId)))) hits.push(d);
        }
      }
      return hits;
    },
    staleTime: 15_000,
  });
}

function RelatedLeadsGroup({ field, recordId }: { field: FieldDefinition; recordId: string }) {
  const labels = useLabels();
  const q = useLeadsLinkedTo(field.key, recordId);
  const href = useLeadHref();
  const plural = labelOf(labels, 'lead', { plural: true });
  const title = configOf({ type: 'relation', config: field.config }).inverseLabel ?? plural;
  const items = q.data?.slice(0, SHOWN) ?? [];
  return (
    <GroupCard
      title={title}
      via={`${labelOf(labels, 'lead')} › ${field.label}`}
      icon={<Link2 className="size-3.5" />}
      count={q.data?.length}
    >
      {q.isPending ? (
        <Skeleton className="h-8 w-full" />
      ) : q.isError ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          These did not load.
          <Button size="sm" variant="link" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </p>
      ) : items.length === 0 ? (
        <p className="px-2 py-1 text-sm text-muted">No {plural.toLowerCase()} linked yet.</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {items.map((l) => (
            <li key={l.id}>
              <Link href={href(l.id)} className={itemLink}>
                <span className="truncate">{l.name}</span>
                {l.companyName && (
                  <span className="truncate text-xs text-muted">{l.companyName}</span>
                )}
              </Link>
            </li>
          ))}
          {(q.data?.length ?? 0) > SHOWN && (
            <li className="px-2 pt-1 text-xs text-muted">
              and {((q.data?.length ?? 0) - SHOWN).toLocaleString('en-IN')} more
            </li>
          )}
        </ul>
      )}
    </GroupCard>
  );
}
