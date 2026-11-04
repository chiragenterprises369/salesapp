import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/** Surface container: Rivet 18px radius, card gradient, 1px border, subtle elevation. */
export function Card({ className, interactive, ...props }: ComponentProps<'div'> & { interactive?: boolean }) {
  return (
    <div
      data-slot="card"
      className={cn(
        'card relative min-w-0 rounded-[var(--r-card,18px)] border border-hair bg-[linear-gradient(180deg,var(--card-top),var(--card)_40%)] text-ink shadow-card',
        interactive && 'transition-[box-shadow,border-color,transform] duration-250 ease-[var(--ease)] hover:border-hair-2 hover:shadow-pop hover:-translate-y-0.5 active:translate-y-0',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex items-start justify-between gap-3 px-4 pt-4 pb-2', className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 data-slot="card-title" className={cn('text-sm font-semibold leading-5 text-fg', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="card-description" className={cn('text-xs text-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-4 pb-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-footer" className={cn('flex items-center gap-2 border-t border-border px-4 py-3', className)} {...props} />;
}
