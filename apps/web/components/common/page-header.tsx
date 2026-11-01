import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Page title row: h1, one-line description, and actions (at most one primary). */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Chips next to the title (status, plan). */
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-0.5 text-sm text-muted-strong">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
