'use client';

import { Check, Minus } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { TAP } from './touch';

/** Token-styled checkbox (Radix, role=checkbox). Supports `checked="indeterminate"`. */
export function Checkbox({ className, checked, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      className={cn(
        'focus-ring peer inline-flex size-4 shrink-0 items-center justify-center rounded-xs border border-input bg-surface text-accent-fg',
        'transition-colors duration-150 ease-standard hover:border-fg-secondary',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="inline-flex items-center justify-center">
        {checked === 'indeterminate' ? <Minus aria-hidden className="size-3" strokeWidth={3} /> : <Check aria-hidden className="size-3" strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/** Checkbox with a clickable label (and optional hint); the whole row is the touch target. */
export function CheckboxRow({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-2.5 py-1', TAP, className)}>
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} disabled={disabled} aria-describedby={hint ? `${id}-hint` : undefined} className="mt-0.5" />
      <span className="flex min-w-0 flex-col">
        <label htmlFor={id} className={cn('cursor-pointer text-sm text-fg', disabled && 'cursor-not-allowed opacity-60')}>
          {label}
        </label>
        {hint && (
          <span id={`${id}-hint`} className="text-xs text-muted">
            {hint}
          </span>
        )}
      </span>
    </div>
  );
}
