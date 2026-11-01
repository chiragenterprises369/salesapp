'use client';

import { RadioGroup } from 'radix-ui';
import { NavIcon, OBJECT_ICON_NAMES } from '@/components/shell/nav-icon';
import { cn } from '@/lib/cn';

const human = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

/** Small lucide icon set for custom objects (arrow keys move between icons). */
export function IconPicker({ value, onChange, disabled }: { value: string; onChange: (icon: string) => void; disabled?: boolean }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium text-fg-secondary">Icon</legend>
      <RadioGroup.Root value={value} onValueChange={onChange} aria-label="Icon" disabled={disabled} className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
        {OBJECT_ICON_NAMES.map((name) => (
          <RadioGroup.Item
            key={name}
            value={name}
            aria-label={human(name)}
            title={human(name)}
            className={cn(
              'focus-ring flex h-11 items-center justify-center rounded-md border border-border bg-surface text-fg-secondary transition-colors hover:border-border-strong hover:text-fg sm:h-9',
              'data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft data-[state=checked]:text-accent-soft-fg',
            )}
          >
            <NavIcon name={name} className="size-4" />
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </fieldset>
  );
}
