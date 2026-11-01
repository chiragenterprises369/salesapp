'use client';

import { AlertTriangle, SearchX, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useLeadWords } from './use-lead-words';

/** Empty / error blocks shared by the Leads views, drawer and dashboard widgets. */
export function EmptyState({
  icon = <SearchX aria-hidden />,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-12 text-center',
        className,
      )}
    >
      <span
        aria-hidden
        className="mb-1 inline-flex size-10 items-center justify-center rounded-full bg-surface-3 text-muted-strong [&_svg]:size-5"
      >
        {icon}
      </span>
      <p className="text-sm font-semibold text-fg">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'Leads did not load',
  description,
  onRetry,
  retrying,
  className,
}: {
  title?: string;
  description?: string;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-12 text-center',
        className,
      )}
    >
      <span
        aria-hidden
        className="mb-1 inline-flex size-10 items-center justify-center rounded-full bg-status-red-bg text-status-red-fg [&_svg]:size-5"
      >
        <AlertTriangle />
      </span>
      <p className="text-sm font-semibold text-fg">{title}</p>
      <p className="max-w-sm text-sm text-muted">
        {description ?? 'The connection dropped while loading. Your filters are kept; try again.'}
      </p>
      <Button className="mt-2" onClick={onRetry} loading={retrying}>
        Try again
      </Button>
    </div>
  );
}

export function NoLeadsYet({ action }: { action?: ReactNode }) {
  const w = useLeadWords();
  return (
    <EmptyState
      icon={<Users aria-hidden />}
      title={`No ${w.leads} yet`}
      description={`New ${w.leads} from IndiaMART, WhatsApp and your website appear here. You can also add or import ${w.leads}.`}
      action={action}
    />
  );
}
