import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * Dense data table primitives (13px, 36px rows; Premium 34px via --table-row-h). Compose with @tanstack/react-table and
 * @tanstack/react-virtual for large lists. Sticky header is on by default; give the wrapper a height.
 * Mark freshly inserted rows with data-new="true" for the slide-in + highlight animation.
 */
export function Table({ className, containerClassName, ...props }: ComponentProps<'table'> & { containerClassName?: string }) {
  return (
    <div data-slot="table-container" className={cn('relative w-full overflow-auto', containerClassName)}>
      <table data-slot="table" className={cn('w-full caption-bottom border-separate border-spacing-0 text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, sticky = true, ...props }: ComponentProps<'thead'> & { sticky?: boolean }) {
  return <thead data-slot="table-header" className={cn(sticky && 'sticky top-0 z-10', '[&_tr]:bg-surface', className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child>td]:border-b-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'group/row transition-colors duration-200 hover:bg-surface-3',
        'data-[state=selected]:bg-accent-soft data-[new=true]:animate-row-in',
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      scope="col"
      className={cn(
        'h-[var(--table-head-h,2rem)] whitespace-nowrap border-b border-border px-3 text-left align-middle text-xs font-semibold text-faint',
        '[&:has([role=checkbox])]:w-8 [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('h-[var(--table-row-h,2.25rem)] whitespace-nowrap border-b border-border px-3 align-middle text-sm font-semibold text-ink [&:has([role=checkbox])]:pr-0', className)}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return <caption data-slot="table-caption" className={cn('mt-3 text-xs text-muted', className)} {...props} />;
}
