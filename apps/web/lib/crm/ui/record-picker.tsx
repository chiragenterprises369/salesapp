'use client';

import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { cn } from '@/lib/cn';

export interface PickerOption {
  id: string;
  label: string;
  meta?: string | null;
}

/**
 * Searchable single-record picker (combobox + listbox). Arrow keys move, Enter picks, Esc closes.
 * The caller owns the search (pass `onQueryChange` and the matching `options`).
 */
export function RecordPicker({
  id,
  value,
  onChange,
  options,
  loading,
  onQueryChange,
  placeholder,
  emptyText = 'No matches. Try another name.',
  disabled,
  invalid,
  describedBy,
  clearable = true,
}: {
  id?: string;
  value: PickerOption | null;
  onChange: (next: PickerOption | null) => void;
  options: readonly PickerOption[];
  loading?: boolean;
  onQueryChange: (q: string) => void;
  placeholder: string;
  emptyText?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (q: string) => {
    setQuery(q);
    setActive(0);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onQueryChange(q.trim()), 200);
  };
  const pick = (o: PickerOption) => {
    onChange(o);
    setOpen(false);
    setQuery('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = options[active];
      if (o) pick(o);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) onQueryChange('');
      }}
    >
      <div className="relative flex w-full min-w-0">
        <PopoverPrimitive.Trigger asChild disabled={disabled}>
          <button
            id={id}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            data-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn(
              'focus-ring inline-flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-surface px-2.5 text-left text-sm shadow-card hover:border-fg-secondary disabled:cursor-not-allowed disabled:opacity-60 data-[invalid=true]:border-danger-text',
              !value && 'text-muted',
              value && clearable && 'pr-8',
            )}
          >
            <span className="truncate">{value ? value.label : placeholder}</span>
            {!(value && clearable) && <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted" />}
          </button>
        </PopoverPrimitive.Trigger>
        {value && clearable && !disabled && (
          <button
            type="button"
            aria-label={`Clear ${value.label}`}
            onClick={() => onChange(null)}
            className="focus-ring absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted hover:bg-surface-3 hover:text-fg"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-slot="popover"
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-64 rounded-md border border-border bg-surface p-1 text-sm text-fg shadow-overlay outline-none data-[state=open]:animate-fade-in"
        >
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={options[active] ? `${listId}-${options[active]!.id}` : undefined}
            aria-label={placeholder}
            value={query}
            onChange={(e) => search(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type to search"
            className="mb-1 h-8 w-full rounded-sm border border-input bg-surface px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
          />
          <ul id={listId} role="listbox" aria-label={placeholder} className="max-h-64 overflow-y-auto">
            {loading && (
              <li className="flex items-center gap-2 px-2 py-2 text-xs text-muted-strong">
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
                Searching…
              </li>
            )}
            {!loading && options.length === 0 && <li className="px-2 py-2 text-xs text-muted-strong">{emptyText}</li>}
            {options.map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-${o.id}`}
                role="option"
                aria-selected={value?.id === o.id}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
                className={cn('flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5', i === active && 'bg-surface-3')}
              >
                <span className="inline-flex size-4 shrink-0 items-center justify-center">{value?.id === o.id && <Check aria-hidden className="size-4 text-accent-text" />}</span>
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.meta && <span className="block truncate text-xs text-muted-strong">{o.meta}</span>}
                </span>
              </li>
            ))}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
