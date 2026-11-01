'use client';

import { Check, ChevronDown } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Token-styled select (Radix). Works inside <FormField> (id / aria props land on the trigger).
 * Usage: <Select value onValueChange options={[{ value, label }]} />.
 */
export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export type SelectProps = Omit<
  ComponentProps<typeof SelectPrimitive.Trigger>,
  'children' | 'value' | 'defaultValue' | 'dir'
> & {
  value?: string;
  onValueChange?: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
};

export function Select({
  value,
  onValueChange,
  options,
  placeholder = 'Select',
  size = 'md',
  className,
  disabled,
  ...trigger
}: SelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        className={cn(
          'inline-flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-surface text-left text-fg shadow-card',
          'transition-[border-color,box-shadow] duration-150 ease-standard hover:border-fg-secondary',
          'focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger-text data-[placeholder]:text-muted',
          size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-2.5 text-sm',
          className,
        )}
        {...trigger}
      >
        <span className="truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-surface text-sm text-fg shadow-overlay data-[state=open]:animate-fade-in"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex h-8 cursor-default select-none items-center gap-2 rounded-sm pr-2 pl-7 outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-3"
              >
                <span className="absolute left-2 inline-flex size-4 items-center justify-center">
                  <SelectPrimitive.ItemIndicator>
                    <Check aria-hidden className="size-4 text-accent-text" />
                  </SelectPrimitive.ItemIndicator>
                </span>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
