'use client';

import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/leads/primitives/popover';
import { cn } from '@/lib/cn';

export interface PickerOption {
  value: string;
  label: string;
  /** Secondary text (company, role, ...). Also searched when filtering locally. */
  hint?: string;
  leading?: ReactNode;
  disabled?: boolean;
}

export interface PickerProps {
  id?: string;
  options: readonly PickerOption[];
  selected: readonly string[];
  onSelect: (value: string) => void;
  multiple?: boolean;
  /** Text on the trigger (selected label, "Choose a supplier", "Add"). */
  triggerLabel: ReactNode;
  /** Accessible name of the popover list, e.g. "Suppliers". */
  listLabel: string;
  placeholder?: string;
  /** Controlled search (server-side filtering). Omit to filter locally. */
  search?: string;
  onSearchChange?: (q: string) => void;
  loading?: boolean;
  emptyText?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  required?: boolean;
  className?: string;
}

/**
 * Searchable picker (Radix popover + cmdk list): arrows move, Enter picks, Esc closes and focus
 * returns to the trigger. Single mode closes on pick; multiple mode stays open and toggles.
 */
export function Picker({
  id,
  options,
  selected,
  onSelect,
  multiple = false,
  triggerLabel,
  listLabel,
  placeholder = 'Search',
  search,
  onSearchChange,
  loading = false,
  emptyText = 'Nothing matches',
  disabled,
  invalid,
  describedBy,
  required,
  className,
}: PickerProps) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const serverSide = search !== undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={contentId}
          aria-haspopup="dialog"
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          aria-describedby={describedBy}
          className={cn(
            'inline-flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-surface px-2.5 text-left text-sm text-fg shadow-card sm:h-8',
            'transition-[border-color,box-shadow] duration-150 ease-standard hover:border-fg-secondary',
            'focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
            'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60 aria-invalid:border-danger-text',
            className,
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{triggerLabel}</span>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        id={contentId}
        aria-label={`Choose ${listLabel.toLowerCase()}`}
        className="w-[min(22rem,calc(100vw-1rem))] p-0"
        align="start"
      >
        <Command label={listLabel} shouldFilter={!serverSide} loop className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search aria-hidden className="size-4 shrink-0 text-muted" />
            <Command.Input
              autoFocus
              value={search}
              onValueChange={onSearchChange}
              placeholder={placeholder}
              className="h-11 w-full min-w-0 bg-transparent text-sm text-fg outline-none placeholder:text-muted sm:h-9"
            />
            {loading && <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-muted" />}
          </div>
          <Command.List className="max-h-64 overflow-y-auto p-1">
            {!loading && (
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted">
                {emptyText}
              </Command.Empty>
            )}
            {loading && options.length === 0 && (
              <Command.Loading>
                <p className="px-3 py-6 text-center text-sm text-muted">Searching…</p>
              </Command.Loading>
            )}
            {options.map((o) => {
              const isSelected = selected.includes(o.value);
              return (
                <Command.Item
                  key={o.value}
                  value={serverSide ? o.value : `${o.label} ${o.hint ?? ''} ${o.value}`}
                  disabled={o.disabled}
                  onSelect={() => {
                    onSelect(o.value);
                    if (!multiple) setOpen(false);
                  }}
                  className="relative flex min-h-11 cursor-pointer items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm text-fg data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50 data-[selected=true]:bg-surface-3 sm:min-h-8"
                >
                  <span
                    aria-hidden
                    className="absolute left-2 inline-flex size-4 items-center justify-center"
                  >
                    {isSelected && <Check className="size-4 text-accent-text" />}
                  </span>
                  {o.leading}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{o.label}</span>
                    {o.hint && <span className="truncate text-xs text-muted">{o.hint}</span>}
                  </span>
                  {isSelected && <span className="sr-only">(selected)</span>}
                </Command.Item>
              );
            })}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
