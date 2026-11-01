'use client';

import { isInDarkWindow, minutesInTimeZone, type ThemeMode } from '@vistar/shared';
import { Check, Clock, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { RadioGroup } from 'radix-ui';
import { useId } from 'react';
import { Label } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { NativeSelect } from './native-select';
import { formatHhMm, hourOptions } from './time';
import { useNow } from './use-now';

export const THEME_MODE_OPTIONS: ReadonlyArray<{ mode: ThemeMode; label: string; hint: string; icon: LucideIcon }> = [
  { mode: 'system', label: 'System', hint: 'Match this device', icon: Monitor },
  { mode: 'light', label: 'Light', hint: 'Always light', icon: Sun },
  { mode: 'dark', label: 'Dark', hint: 'Always dark', icon: Moon },
  { mode: 'scheduled', label: 'Scheduled', hint: 'Dark during set hours', icon: Clock },
];

export const THEME_MODE_LABEL: Record<ThemeMode, string> = { system: 'System', light: 'Light', dark: 'Dark', scheduled: 'Scheduled' };

interface ThemeModeRadioProps {
  value: ThemeMode;
  onValueChange: (mode: ThemeMode) => void;
  /** list = compact rows (menus); cards = 2x2 / 4-up tiles (settings pages, 44px targets). */
  variant?: 'list' | 'cards';
  label: string;
  disabled?: boolean;
}

/** Radio group for the four theme modes. Arrow keys move and select (Radix RadioGroup). */
export function ThemeModeRadio({ value, onValueChange, variant = 'list', label, disabled }: ThemeModeRadioProps) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(v) => onValueChange(v as ThemeMode)}
      aria-label={label}
      disabled={disabled}
      className={cn(variant === 'cards' ? 'grid grid-cols-2 gap-2 sm:grid-cols-4' : 'flex flex-col gap-0.5')}
    >
      {THEME_MODE_OPTIONS.map(({ mode, label: optionLabel, hint, icon: Icon }) =>
        variant === 'cards' ? (
          <RadioGroup.Item
            key={mode}
            value={mode}
            className={cn(
              'focus-ring group flex min-h-11 flex-col items-start gap-1 rounded-md border border-border bg-surface p-3 text-left',
              'transition-[border-color,background-color] duration-150 ease-standard hover:border-border-strong hover:bg-surface-2',
              'data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <Icon aria-hidden className="size-4 text-fg-secondary group-data-[state=checked]:text-accent-soft-fg" />
              <RadioGroup.Indicator>
                <Check aria-hidden className="size-4 text-accent-soft-fg" />
              </RadioGroup.Indicator>
            </span>
            <span className="text-sm font-medium text-fg group-data-[state=checked]:text-accent-soft-fg">{optionLabel}</span>
            <span className="text-xs text-muted group-data-[state=checked]:text-muted-strong">{hint}</span>
          </RadioGroup.Item>
        ) : (
          <RadioGroup.Item
            key={mode}
            value={mode}
            className={cn(
              'focus-ring group flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm text-fg',
              'transition-colors duration-150 ease-standard hover:bg-surface-2',
              'data-[state=checked]:bg-accent-soft data-[state=checked]:text-accent-soft-fg',
            )}
          >
            <Icon aria-hidden className="size-4 shrink-0 text-fg-secondary group-data-[state=checked]:text-accent-soft-fg" />
            <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
              <span className="font-medium">{optionLabel}</span>
              <span className="truncate text-xs text-muted group-data-[state=checked]:text-muted-strong">{hint}</span>
            </span>
            <span className="flex size-4 shrink-0 items-center justify-center">
              <RadioGroup.Indicator>
                <Check aria-hidden className="size-4" />
              </RadioGroup.Indicator>
            </span>
          </RadioGroup.Item>
        ),
      )}
    </RadioGroup.Root>
  );
}

interface ScheduleFieldsProps {
  darkFrom: string;
  darkTo: string;
  onChange: (patch: { darkFrom?: string; darkTo?: string }) => void;
  timeZone: string;
  size?: 'md' | 'touch';
  disabled?: boolean;
}

/** Hour pickers for Scheduled mode, with a live "dark now / light now" line in the workspace timezone. */
export function ScheduleFields({ darkFrom, darkTo, onChange, timeZone, size = 'md', disabled }: ScheduleFieldsProps) {
  const id = useId();
  const now = useNow(30_000);
  const options = hourOptions([darkFrom, darkTo]);
  const same = darkFrom === darkTo;
  const darkNow = now > 0 && !same ? isInDarkWindow(minutesInTimeZone(new Date(now), timeZone), darkFrom, darkTo) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-from`}>Dark from</Label>
          <NativeSelect
            id={`${id}-from`}
            size={size}
            value={darkFrom}
            disabled={disabled}
            aria-invalid={same || undefined}
            aria-describedby={`${id}-status`}
            onChange={(e) => onChange({ darkFrom: e.target.value })}
          >
            {options.map((o) => (
              <option key={o} value={o}>
                {formatHhMm(o)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-to`}>Light from</Label>
          <NativeSelect
            id={`${id}-to`}
            size={size}
            value={darkTo}
            disabled={disabled}
            aria-invalid={same || undefined}
            aria-describedby={`${id}-status`}
            onChange={(e) => onChange({ darkTo: e.target.value })}
          >
            {options.map((o) => (
              <option key={o} value={o}>
                {formatHhMm(o)}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <p id={`${id}-status`} className={cn('text-xs', same ? 'text-danger-text' : 'text-muted')} role={same ? 'alert' : undefined}>
        {same
          ? 'Pick two different times. With the same start and end the theme stays light.'
          : darkNow === null
            ? `Times use the workspace timezone (${timeZone}).`
            : `${darkNow ? 'Dark' : 'Light'} now. Switches at ${formatHhMm(darkNow ? darkTo : darkFrom)}, ${timeZone} time.`}
      </p>
    </div>
  );
}
