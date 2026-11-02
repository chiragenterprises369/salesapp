'use client';

import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const TooltipProvider = TooltipPrimitive.Provider;

/** Short label on hover and keyboard focus (icon rail). The trigger must still have its own accessible name. */
export function Tooltip({
  content,
  children,
  side = 'right',
  className,
  ...props
}: { content: ReactNode; children: ReactNode; side?: ComponentProps<typeof TooltipPrimitive.Content>['side']; className?: string } & Omit<
  ComponentProps<typeof TooltipPrimitive.Root>,
  'children'
>) {
  return (
    <TooltipPrimitive.Root {...props}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          data-slot="tooltip"
          side={side}
          sideOffset={8}
          className={cn('z-50 rounded-md bg-fg px-2 py-1 text-xs font-medium text-bg shadow-overlay data-[state=delayed-open]:animate-fade-in', className)}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
