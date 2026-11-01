'use client';

import { AlertCircle, Info, RotateCw, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiRequestError } from '@/lib/customization';
import { cn } from '@/lib/cn';

/** User-safe message for a failed request: the API message, else a generic sentence. */
export function errorMessage(e: unknown, fallback = 'That did not work. Check your connection and try again.'): string {
  return isApiRequestError(e) ? e.message : fallback;
}

export const errorCode = (e: unknown) => (isApiRequestError(e) ? e.code : null);

/** Skeleton rows shaped like a settings list. */
export function ListSkeleton({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-2">
      <span role="status" className="sr-only">
        {label}
      </span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-3">
          <Skeleton className="size-8 rounded-md" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Load failure with a retry. */
export function LoadError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <EmptyState
      icon={<AlertCircle />}
      title={title}
      description="Check your connection, then try again."
      action={
        <Button onClick={onRetry}>
          <RotateCw aria-hidden />
          Try again
        </Button>
      }
    />
  );
}

const TONES = {
  danger: { box: 'border-status-red-border bg-status-red-bg text-status-red-fg', icon: AlertCircle },
  warning: { box: 'border-status-amber-border bg-status-amber-bg text-status-amber-fg', icon: TriangleAlert },
  info: { box: 'border-border bg-surface-2 text-fg-secondary', icon: Info },
} as const;

/** Inline message box. Danger alerts are announced (role="alert"); others are plain notes. */
export function InlineAlert({
  tone = 'danger',
  title,
  children,
  onDismiss,
  className,
}: {
  tone?: keyof typeof TONES;
  title?: ReactNode;
  children?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const { box, icon: Icon } = TONES[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : undefined} className={cn('flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm', box, className)}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'text-sm')}>{children}</div>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="focus-ring -m-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-surface/40">
          <X aria-hidden className="size-4" />
        </button>
      )}
    </div>
  );
}
