import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

const sizes = {
  sm: 'h-7 pl-2 pr-7 text-xs',
  md: 'h-8 pl-2.5 pr-8 text-sm',
  /** Employee panel: 44px target. */
  touch: 'h-11 pl-3 pr-9 text-base',
} as const;

export type NativeSelectProps = Omit<ComponentProps<'select'>, 'size'> & {
  size?: keyof typeof sizes;
  wrapperClassName?: string;
};

/**
 * Native <select> styled like the kit Input (border-input edge, visible focus). Native keeps the
 * platform picker on mobile and is fully keyboard and screen-reader operable. Works inside <FormField>.
 */
export function NativeSelect({ className, wrapperClassName, size = 'md', children, ...props }: NativeSelectProps) {
  return (
    <span className={cn('relative inline-flex w-full min-w-0', wrapperClassName)}>
      <select
        data-slot="native-select"
        className={cn(
          'w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-surface text-fg shadow-card',
          'transition-[border-color,box-shadow] duration-150 ease-standard hover:border-fg-secondary',
          'focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60',
          'aria-invalid:border-danger-text',
          sizes[size],
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted', size === 'touch' ? 'right-3 size-5' : 'right-2 size-4')}
      />
    </span>
  );
}
