import { EMPLOYEE_STATUS_LABEL, initials, type EmployeeStatus } from '@vistar/shared';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

const sizes = {
  xs: 'size-5 text-2xs',
  sm: 'size-6 text-2xs',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
  xl: 'size-14 text-lg',
} as const;

const dotTone: Record<EmployeeStatus, string> = {
  on_call: 'bg-status-blue-fg',
  idle: 'bg-status-green-fg',
  busy: 'bg-status-amber-fg',
  away: 'bg-status-grey-fg',
  offline: 'bg-status-grey-fg',
};

export type AvatarProps = ComponentProps<'span'> & {
  name: string;
  size?: keyof typeof sizes;
  /** Adds a presence dot (bottom-right) with an accessible label. */
  status?: EmployeeStatus;
};

/** Initials circle (design system: no photos in core UI). */
export function Avatar({ name, size = 'md', status, className, ...props }: AvatarProps) {
  return (
    <span data-slot="avatar" className={cn('relative inline-flex shrink-0', className)} {...props}>
      <span
        aria-hidden
        className={cn('inline-flex items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-soft-fg select-none', sizes[size])}
      >
        {initials(name)}
      </span>
      <span className="sr-only">
        {name}
        {status ? `, ${EMPLOYEE_STATUS_LABEL[status]}` : ''}
      </span>
      {status && (
        <span
          aria-hidden
          className={cn('absolute -right-0.5 -bottom-0.5 rounded-full ring-2 ring-surface', size === 'xs' || size === 'sm' ? 'size-2' : 'size-2.5', dotTone[status])}
        />
      )}
    </span>
  );
}
