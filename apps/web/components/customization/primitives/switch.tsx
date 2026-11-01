'use client';

import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * Token-styled switch (Radix, role=switch). The 44 px hit area comes from the wrapper padding so the
 * visual track stays compact in dense forms.
 */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'group/switch focus-ring relative inline-flex h-11 w-14 shrink-0 cursor-pointer items-center justify-center rounded-full',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'relative inline-flex h-5 w-9 items-center rounded-full border border-input bg-surface-3 transition-colors duration-150 ease-standard',
          'group-data-[state=checked]/switch:border-accent group-data-[state=checked]/switch:bg-accent',
        )}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            'block size-4 translate-x-0.5 rounded-full bg-surface shadow-card ring-1 ring-border transition-transform duration-150 ease-standard motion-reduce:transition-none',
            'data-[state=checked]:translate-x-[17px] data-[state=checked]:ring-accent',
          )}
        />
      </span>
    </SwitchPrimitive.Root>
  );
}
