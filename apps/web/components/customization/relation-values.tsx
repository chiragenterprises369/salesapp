'use client';

import { labelOf, objectRecordsHref, parseTarget, type FieldTarget } from '@vistar/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCustomObject, useLabels, useRecord } from '@/lib/customization';
import { useLead } from '@/lib/leads/data';
import { cn } from '@/lib/cn';
import { shortId } from './field-utils';

/** Detail URL of a record of a custom object. */
export const recordHref = (objectKey: string, id: string) =>
  `${objectRecordsHref(objectKey)}/${id}`;

/** Lead detail URL for the panel the user is in (/me for the Employee panel). */
export function useLeadHref() {
  const path = usePathname() ?? '';
  const base = path.startsWith('/me') ? '/me/leads' : '/app/leads';
  return (id: string) => `${base}/${id}`;
}

const linkClass = 'focus-ring rounded-xs text-accent-text underline-offset-2 hover:underline';

function Unavailable({ id }: { id: string }) {
  return (
    <span className="text-muted" title={id}>
      Record not available <span className="sr-only">(id {shortId(id)})</span>
    </span>
  );
}

function TitleSkeleton() {
  return (
    <span className="inline-flex">
      <span
        aria-hidden
        className="inline-block h-3.5 w-20 animate-pulse rounded-xs bg-skeleton align-middle"
      />
      <span className="sr-only">Loading</span>
    </span>
  );
}

/** Title of a custom object record, as a link to its detail page. */
export function RecordLink({
  objectKey,
  id,
  className,
  plain = false,
}: {
  objectKey: string;
  id: string;
  className?: string;
  plain?: boolean;
}) {
  const q = useRecord(objectKey, id);
  if (q.isPending) return <TitleSkeleton />;
  if (q.isError || !q.data) return <Unavailable id={id} />;
  if (plain) return <span className={cn('truncate', className)}>{q.data.title || 'Untitled'}</span>;
  return (
    <Link href={recordHref(objectKey, id)} className={cn(linkClass, className)}>
      {q.data.title || 'Untitled'}
    </Link>
  );
}

/** Lead name, as a link to the lead page. */
export function LeadLink({
  id,
  className,
  plain = false,
}: {
  id: string;
  className?: string;
  plain?: boolean;
}) {
  const q = useLead(id);
  const href = useLeadHref();
  if (q.isPending) return <TitleSkeleton />;
  if (q.isError || !q.data) return <Unavailable id={id} />;
  if (plain) return <span className={cn('truncate', className)}>{q.data.name}</span>;
  return (
    <Link href={href(id)} className={cn(linkClass, className)}>
      {q.data.name}
    </Link>
  );
}

/** Linked record(s) of a relation field, resolved to titles. `plain` renders text (inside other links). */
export function RelationValue({
  target,
  ids,
  className,
  plain = false,
}: {
  target: FieldTarget | null;
  ids: readonly string[];
  className?: string;
  plain?: boolean;
}) {
  if (!target) return <span className="text-muted">Link target is not set up</span>;
  const t = parseTarget(target);
  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1', className)}>
      {ids.map((id, i) => (
        <span key={id} className="inline-flex min-w-0 items-center">
          {t.kind === 'object' ? (
            <RecordLink objectKey={t.key} id={id} plain={plain} />
          ) : t.entity === 'lead' ? (
            <LeadLink id={id} plain={plain} />
          ) : (
            <span title={id}>Record {shortId(id)}</span>
          )}
          {i < ids.length - 1 && (
            <span aria-hidden className="text-muted">
              ,
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

/** Display name of a relation target ("Supplier", "Enquiry"), for pickers and empty states. */
export function useTargetLabel(
  target: FieldTarget | null,
  opts: { plural?: boolean } = {},
): string {
  const labels = useLabels();
  const t = target ? parseTarget(target) : null;
  const obj = useCustomObject(t?.kind === 'object' ? t.key : null);
  if (!t) return opts.plural ? 'records' : 'record';
  if (t.kind === 'object')
    return (
      (opts.plural ? obj.data?.labelPlural : obj.data?.labelSingular) ??
      (opts.plural ? 'records' : 'record')
    );
  return labelOf(labels, t.entity, { plural: opts.plural });
}
