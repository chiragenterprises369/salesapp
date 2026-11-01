import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Empty, no-access and "not connected yet" states. Says what is missing and offers the next step;
 * never a dead end.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  size = 'md',
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-lg border border-dashed border-border-strong bg-surface text-center',
        size === 'sm' ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14',
        className,
      )}
    >
      {icon && (
        <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-surface-3 text-fg-secondary [&_svg]:size-5">
          {icon}
        </span>
      )}
      <div className="flex max-w-md flex-col gap-1">
        <h2 className={cn('font-semibold text-fg', size === 'sm' ? 'text-sm' : 'text-base')}>{title}</h2>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {(action || secondaryAction) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
