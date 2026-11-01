'use client';

import { endOfDay, format, startOfDay, subDays } from 'date-fns';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { useLeadsViewState } from '@/lib/leads/state';
import { ACTIVE_FILTER_CLASS } from './lead-meta';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './primitives/menu';
import { Popover, PopoverAnchor, PopoverContent } from './primitives/popover';

type Preset = 'any' | 'today' | '7d' | '30d' | 'custom';

const PRESETS: Array<{ id: Exclude<Preset, 'custom'>; label: string }> = [
  { id: 'any', label: 'Any time' },
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
];

export function presetFrom(id: Preset, now = new Date()): string | undefined {
  if (id === 'today') return startOfDay(now).toISOString();
  if (id === '7d') return startOfDay(subDays(now, 6)).toISOString();
  if (id === '30d') return startOfDay(subDays(now, 29)).toISOString();
  return undefined;
}

export function detectPreset(from?: string, to?: string): Preset {
  if (!from && !to) return 'any';
  if (to) return 'custom';
  for (const p of ['today', '7d', '30d'] as const) if (presetFrom(p) === from) return p;
  return 'custom';
}

export function dateRangeLabel(from?: string, to?: string): string {
  const preset = detectPreset(from, to);
  if (preset !== 'custom') return PRESETS.find((p) => p.id === preset)!.label;
  return `${from ? format(new Date(from), 'd MMM') : 'Start'} – ${to ? format(new Date(to), 'd MMM') : 'today'}`;
}

const toDateInput = (iso?: string) => (iso ? format(new Date(iso), 'yyyy-MM-dd') : '');

/** Created-date filter: quick picks (Today, 7 days, 30 days) and a custom from/to range. */
export function DateRangeFilter() {
  const createdFrom = useLeadsViewState((s) => s.filters.createdFrom);
  const createdTo = useLeadsViewState((s) => s.filters.createdTo);
  const setFilters = useLeadsViewState((s) => s.setFilters);
  const preset = detectPreset(createdFrom, createdTo);
  const label = dateRangeLabel(createdFrom, createdTo);
  const [customOpen, setCustomOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const openingCustom = useRef(false);
  const invalid = !!from && !!to && from > to;

  const applyCustom = () => {
    if (invalid || (!from && !to)) return;
    setFilters({
      createdFrom: from ? startOfDay(new Date(`${from}T00:00:00`)).toISOString() : undefined,
      createdTo: to ? endOfDay(new Date(`${to}T00:00:00`)).toISOString() : undefined,
    });
    setCustomOpen(false);
  };

  return (
    <Popover open={customOpen} onOpenChange={setCustomOpen}>
      <DropdownMenu>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`Created date: ${label}`}
              className={preset !== 'any' ? ACTIVE_FILTER_CLASS : undefined}
            >
              <CalendarDays aria-hidden />
              <span className="max-w-36 truncate">{label}</span>
              <ChevronDown aria-hidden className="text-muted" />
            </Button>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent
          className="w-52"
          onCloseAutoFocus={(e) => {
            if (openingCustom.current) {
              e.preventDefault();
              openingCustom.current = false;
            }
          }}
        >
          <DropdownMenuLabel>Created</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preset}
            onValueChange={(v) =>
              setFilters({ createdFrom: presetFrom(v as Preset), createdTo: undefined })
            }
          >
            {PRESETS.map((p) => (
              <DropdownMenuRadioItem key={p.id} value={p.id}>
                {p.label}
              </DropdownMenuRadioItem>
            ))}
            {preset === 'custom' && (
              <DropdownMenuRadioItem value="custom">{label}</DropdownMenuRadioItem>
            )}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              openingCustom.current = true;
              setFrom(toDateInput(createdFrom));
              setTo(toDateInput(createdTo));
              setTimeout(() => setCustomOpen(true), 0);
            }}
          >
            <CalendarDays aria-hidden />
            Custom range…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent className="w-72" aria-label="Custom created date range">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            applyCustom();
          }}
        >
          <p className="text-sm font-medium">Custom range</p>
          <div className="grid grid-cols-2 gap-2">
            <FormField label="From">
              <Input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
              />
            </FormField>
            <FormField label="To" error={invalid ? 'Pick a date after From' : undefined}>
              <Input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
              />
            </FormField>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setCustomOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" disabled={invalid || (!from && !to)}>
              Apply range
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
