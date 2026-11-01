import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/** Loading placeholder. Match the final layout's size so content does not shift. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="skeleton" aria-hidden className={cn('animate-pulse rounded-md bg-skeleton', className)} {...props} />;
}
