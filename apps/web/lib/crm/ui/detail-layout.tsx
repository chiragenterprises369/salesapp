'use client';

import { AlertCircle, ArrowLeft, RotateCw, SearchX } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiRequestError } from '@/lib/api-error';
import { cn } from '@/lib/cn';

/** Detail page header: back link, title, subtitle, chips and actions (one primary at most). */
export function DetailHeader({
  backHref,
  backLabel,
  title,
  subtitle,
  meta,
  actions,
}: {
  backHref: string;
  backLabel: string;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header data-slot="page-header" className="mb-5 flex flex-col gap-3">
      <Link href={backHref} className="focus-ring inline-flex w-max items-center gap-1 rounded-sm text-sm text-muted-strong hover:text-fg">
        <ArrowLeft aria-hidden className="size-4" />
        {backLabel}
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 data-slot="page-title" className="truncate text-xl font-semibold tracking-tight text-fg">
              {title}
            </h1>
            {meta}
          </div>
          {subtitle && <p className="mt-0.5 text-sm text-muted-strong">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Main column + side column (related records). Side drops below on narrow screens. */
export function DetailGrid({ main, side }: { main: ReactNode; side?: ReactNode }) {
  return (
    <div className={cn('grid gap-4', side && 'xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_420px]')}>
      <div className="flex min-w-0 flex-col gap-4">{main}</div>
      {side && <aside className="flex min-w-0 flex-col gap-4">{side}</aside>}
    </div>
  );
}

/** Card section with a heading and optional actions. */
export function DetailSection({ title, actions, children, className, id }: { title: string; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <Card className={cn('flex flex-col', className)} aria-labelledby={headingId} role={headingId ? 'region' : undefined}>
      <div data-slot="panel-head" className="flex min-h-11 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 id={headingId} className="text-sm font-semibold text-fg">
          {title}
        </h2>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

/** Label/value list; two columns on wide screens (D-066). Empty values show a dash. */
export function FieldList({ items, columns = 2 }: { items: ReadonlyArray<{ label: string; value: ReactNode; wide?: boolean }>; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', columns >= 2 && 'sm:grid-cols-2', columns === 3 && '2xl:grid-cols-3')}>
      {items.map((it) => (
        <div key={it.label} className={cn('min-w-0', it.wide && 'sm:col-span-2 2xl:col-span-full')}>
          <dt className="text-xs font-medium text-muted-strong">{it.label}</dt>
          <dd className="mt-0.5 text-sm break-words text-fg">{it.value === null || it.value === undefined || it.value === '' ? <span className="text-muted">-</span> : it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DetailSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-7 w-72" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
        <Skeleton className="h-80 w-full rounded-lg" />
      </div>
    </div>
  );
}

/** Not found / failed state for a detail page (never a dead end). */
export function DetailError({ error, onRetry, backHref, backLabel, noun }: { error: unknown; onRetry: () => void; backHref: string; backLabel: string; noun: string }) {
  const missing = isApiRequestError(error) && (error.status === 404 || error.code === 'NOT_FOUND');
  const forbidden = isApiRequestError(error) && error.status === 403;
  return (
    <EmptyState
      icon={missing ? <SearchX /> : <AlertCircle />}
      title={missing ? `This ${noun} was not found` : forbidden ? `You cannot open this ${noun}` : `This ${noun} did not load`}
      description={
        missing
          ? `It may have been deleted or merged into another ${noun}.`
          : forbidden
            ? `It belongs to someone outside your data scope. Ask a manager if you need it.`
            : isApiRequestError(error)
              ? error.message
              : 'Check your connection, then try again.'
      }
      action={
        <Button asChild>
          <Link href={backHref}>{backLabel}</Link>
        </Button>
      }
      secondaryAction={
        !missing && !forbidden ? (
          <Button variant="ghost" onClick={onRetry}>
            <RotateCw aria-hidden />
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}
