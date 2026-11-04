import { EMPLOYEE_STATUS_LABEL, EMPLOYEE_STATUS_TONE, type ChipTone, type EmployeeStatus } from '@vistar/shared';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * Soft status chip. Status colours are fixed by the design system:
 * on call = blue, idle = green, busy = amber, offline/away = grey, error = red. Indigo = accent/selected.
 */
export const chipVariants = cva('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold tracking-tight', {
  variants: {
    tone: {
      neutral: 'border-border bg-surface-2 text-fg-secondary',
      indigo: 'border-status-indigo-border bg-status-indigo-bg text-status-indigo-fg',
      blue: 'border-status-blue-border bg-status-blue-bg text-status-blue-fg',
      green: 'border-status-green-border bg-status-green-bg text-status-green-fg',
      amber: 'border-status-amber-border bg-status-amber-bg text-status-amber-fg',
      grey: 'border-status-grey-border bg-status-grey-bg text-status-grey-fg',
      red: 'border-status-red-border bg-status-red-bg text-status-red-fg',
    } satisfies Record<ChipTone, string>,
    size: {
      sm: 'h-5 px-2 text-2xs [&_svg]:size-3',
      md: 'h-6 px-2.5 text-xs [&_svg]:size-3.5',
    },
  },
  defaultVariants: { tone: 'neutral', size: 'sm' },
});

export type ChipProps = ComponentProps<'span'> & VariantProps<typeof chipVariants> & { dot?: boolean };

export function Chip({ className, tone, size, dot, children, ...props }: ChipProps) {
  return (
    <span data-slot="chip" className={cn(chipVariants({ tone, size }), className)} {...props}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current shadow-[0_0_6px_currentColor]" />}
      {children}
    </span>
  );
}

/** Employee presence chip using the shared status -> tone mapping. */
export function StatusChip({ status, className, ...props }: Omit<ChipProps, 'tone' | 'children'> & { status: EmployeeStatus }) {
  return (
    <Chip tone={EMPLOYEE_STATUS_TONE[status]} dot className={className} {...props}>
      {EMPLOYEE_STATUS_LABEL[status]}
    </Chip>
  );
}
