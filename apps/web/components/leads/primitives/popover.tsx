'use client';

import { Popover as PopoverPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/** Token-styled popover (Radix): focus moves in, Esc closes, focus returns to the trigger. */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  className,
  sideOffset = 4,
  align = 'start',
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-50 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-surface p-3 text-sm text-fg shadow-overlay outline-none data-[state=open]:animate-fade-in',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
