'use client';

import { formatFieldValue, type ChipTone, type CustomFieldValue } from '@vistar/shared';
import { mockUsers } from '@vistar/shared/fixtures';
import { format } from 'date-fns';
import { ExternalLink, MapPin, Paperclip } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/cn';
import {
  configOf,
  isEmptyValue,
  relationTargetOf,
  safeHref,
  shortId,
  type FieldDef,
} from './field-utils';
import { RelationValue } from './relation-values';

const USERS = new Map(mockUsers().map((u) => [u.id, u.name]));
const ids = (v: CustomFieldValue) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []);
const linkClass =
  'focus-ring inline-flex min-w-0 items-center gap-1 rounded-xs text-accent-text underline-offset-2 hover:underline';

/**
 * Read view of one custom field value. Money in ₹ with Indian grouping, choices as chips, people as
 * avatars, relations as links titled by the linked record, URLs as safe external links.
 * `compact` keeps everything on one line (table cells, cards).
 */
export function CustomFieldDisplay({
  def,
  value,
  compact = false,
  plain = false,
  className,
}: {
  def: FieldDef;
  value: CustomFieldValue | undefined;
  compact?: boolean;
  /** Text only, no links (use inside another link, e.g. mobile cards). */
  plain?: boolean;
  className?: string;
}) {
  if (isEmptyValue(value) || value === undefined) {
    return <span className={cn('text-muted', className)}>{compact ? '—' : 'Not set'}</span>;
  }
  const wrap = compact ? 'truncate' : 'break-words';
  switch (def.type) {
    case 'text': {
      const multiline = configOf({ type: 'text', config: def.config }).multiline;
      return (
        <span className={cn(wrap, multiline && !compact && 'whitespace-pre-wrap', className)}>
          {String(value)}
        </span>
      );
    }
    case 'number': {
      const unit = configOf({ type: 'number', config: def.config }).unit;
      const n =
        typeof value === 'number'
          ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 6 }).format(value)
          : String(value);
      return <span className={cn('tabular', className)}>{unit ? `${n} ${unit}` : n}</span>;
    }
    case 'money':
      return <span className={cn('tabular', className)}>{formatFieldValue(def, value)}</span>;
    case 'date': {
      const withTime = configOf({ type: 'date', config: def.config }).withTime;
      const d = typeof value === 'string' ? new Date(withTime ? value : `${value}T00:00:00`) : null;
      if (!d || Number.isNaN(d.getTime()))
        return <span className={className}>{String(value)}</span>;
      return (
        <time dateTime={String(value)} className={cn('tabular', className)}>
          {format(d, withTime ? 'd MMM yyyy, h:mm a' : 'd MMM yyyy')}
        </time>
      );
    }
    case 'select':
    case 'multi_select': {
      const options = configOf({ type: def.type, config: def.config }).options;
      const values = ids(value);
      return (
        <span
          className={cn(
            'inline-flex min-w-0 gap-1',
            compact ? 'overflow-hidden' : 'flex-wrap',
            className,
          )}
        >
          {values.map((v) => {
            const o = options.find((x) => x.value === v);
            return (
              <Chip key={v} tone={(o?.color ?? 'neutral') as ChipTone}>
                {o?.label ?? v}
              </Chip>
            );
          })}
        </span>
      );
    }
    case 'user':
      return (
        <span
          className={cn(
            'inline-flex min-w-0 items-center gap-x-2 gap-y-1',
            compact ? 'overflow-hidden' : 'flex-wrap',
            className,
          )}
        >
          {ids(value).map((uid) => {
            const name = USERS.get(uid) ?? `Former teammate ${shortId(uid)}`;
            return (
              <span key={uid} className="inline-flex min-w-0 items-center gap-1.5">
                <Avatar name={name} size="xs" aria-hidden />
                <span className="truncate">{name}</span>
              </span>
            );
          })}
        </span>
      );
    case 'relation':
      return (
        <RelationValue
          target={relationTargetOf(def)}
          ids={ids(value)}
          plain={plain}
          className={cn(compact && 'flex-nowrap overflow-hidden', className)}
        />
      );
    case 'file':
      return (
        <span
          className={cn(
            'inline-flex min-w-0 flex-wrap items-center gap-2 text-fg-secondary',
            className,
          )}
        >
          {ids(value).map((f) => (
            <span key={f} className="inline-flex items-center gap-1">
              <Paperclip aria-hidden className="size-3.5 text-muted" />
              File {shortId(f)}
            </span>
          ))}
        </span>
      );
    case 'geo_point': {
      if (typeof value !== 'object' || Array.isArray(value) || value === null)
        return <span className={className}>{String(value)}</span>;
      const text = formatFieldValue(def, value);
      if (plain) return <span className={cn('tabular truncate', className)}>{text}</span>;
      return (
        <a
          className={cn(linkClass, 'tabular', className)}
          href={`https://www.openstreetmap.org/?mlat=${value.lat}&mlon=${value.lng}#map=16/${value.lat}/${value.lng}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MapPin aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{text}</span>
          <span className="sr-only">(opens a map in a new tab)</span>
        </a>
      );
    }
    case 'boolean':
      return <span className={className}>{value ? 'Yes' : 'No'}</span>;
    case 'url': {
      const href = typeof value === 'string' ? safeHref(value) : null;
      if (!href || plain) return <span className={cn(wrap, className)}>{String(value)}</span>;
      const shown = href.replace(/^https?:\/\//, '').replace(/\/$/, '');
      return (
        <a
          className={cn(linkClass, className)}
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          <span className="truncate">{shown}</span>
          <ExternalLink aria-hidden className="size-3.5 shrink-0" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      );
    }
  }
}
