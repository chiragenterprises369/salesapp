import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export const buttonVariants = cva(
  [
    'relative inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--r-ctl,10px)] font-semibold',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-standard',
    'focus-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'magnetic bg-accent text-accent-fg font-bold hover:bg-accent-hover hover:shadow-[var(--glow)] active:scale-[0.96] transition-transform duration-150',
        secondary: 'border border-hair bg-card text-ink font-semibold hover:border-hair-2 hover:bg-well active:bg-well active:scale-[0.96] transition-transform duration-150',
        ghost: 'text-dim hover:bg-well hover:text-ink active:scale-[0.96] transition-transform duration-150',
        danger: 'bg-danger text-danger-fg font-semibold hover:bg-danger-hover active:scale-[0.96] transition-transform duration-150',
        link: 'h-auto px-0 text-accent-text underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-xs rounded-[8px] gap-1.5 [&_svg]:size-[15px]',
        md: 'h-10 px-4 text-sm rounded-[10px] gap-2 [&_svg]:size-[17px]',
        lg: 'h-11 px-5 text-base rounded-[12px] gap-2 [&_svg]:size-5',
        icon: 'size-10 rounded-[10px] [&_svg]:size-[17px]',
        'icon-sm': 'size-8 rounded-[8px] [&_svg]:size-[15px]',
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
