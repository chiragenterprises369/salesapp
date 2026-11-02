import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export const buttonVariants = cva(
  [
    'relative inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium',
    'transition-[background-color,border-color,color,box-shadow] duration-150 ease-standard',
    'focus-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg shadow-card hover:bg-accent-hover active:bg-accent-active',
        secondary: 'border border-border bg-surface text-fg shadow-card hover:bg-surface-2 active:bg-surface-3',
        ghost: 'text-fg-secondary hover:bg-surface-3 hover:text-fg active:bg-surface-3',
        danger: 'bg-danger text-danger-fg shadow-card hover:bg-danger-hover',
        link: 'h-auto px-0 text-accent-text underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-8 px-3 text-sm',
        lg: 'h-10 px-4 text-base',
        icon: 'size-8 text-sm',
        'icon-sm': 'size-7 text-xs [&_svg]:size-3.5',
        /** Employee panel / touch: 44x44 minimum target. */
        touch: 'h-11 min-w-11 px-3 text-base [&_svg]:size-5',
        'icon-touch': 'size-11 [&_svg]:size-5',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element (e.g. next/link) with button styles. */
    asChild?: boolean;
    /** Shows a spinner, sets aria-busy and blocks clicks. Keeps the label for width stability. */
    loading?: boolean;
  };

/**
 * Button. Icon-only buttons MUST pass `aria-label`.
 * Variants: primary (one per view), secondary (default), ghost, danger, link.
 */
export function Button({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? 'secondary'}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-disabled={asChild && (disabled || loading) ? true : undefined}
      aria-busy={loading || undefined}
      {...(!asChild && !props.type ? { type: 'button' as const } : {})}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 aria-hidden className="absolute animate-spin" />}
          <span className={cn('inline-flex items-center gap-1.5', loading && 'invisible')}>{children}</span>
        </>
      )}
    </Comp>
  );
}
