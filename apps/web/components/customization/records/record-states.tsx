'use client';

import { FileQuestion } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/leads/states';

/** Unknown, archived or out-of-scope object or record: a friendly dead end with a way back. */
export function RecordsNotFound({
  kind,
  label,
  backHref,
  backLabel,
}: {
  kind: 'object' | 'record';
  label?: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface shadow-card">
      <EmptyState
        icon={<FileQuestion aria-hidden />}
        title={
          kind === 'object'
            ? 'This list is not available'
            : `This ${label?.toLowerCase() ?? 'record'} is not available`
        }
        description={
          kind === 'object'
            ? 'It may have been archived by a company admin, or the link is wrong.'
            : 'It may have been deleted, or it belongs to someone outside your team.'
        }
        action={
          <Button asChild className="h-11 sm:h-8">
            <Link href={backHref}>{backLabel}</Link>
          </Button>
        }
      />
    </div>
  );
}

export function RecordsListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading records"
      className="flex flex-col gap-3"
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="ml-auto h-8 w-28" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-full sm:w-64" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="flex flex-col gap-px overflow-hidden rounded-lg border border-border">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-10 rounded-none" />
        ))}
      </div>
    </div>
  );
}

export function RecordDetailSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading record" className="flex flex-col gap-4">
      <Skeleton className="h-4 w-28" />
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-md" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton className="h-72 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    </div>
  );
}
