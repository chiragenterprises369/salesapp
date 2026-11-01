'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useLeadsViewState } from '@/lib/leads/state';
import { cn } from '@/lib/cn';
import { useLeadWords } from './use-lead-words';

const DEBOUNCE_MS = 250;

/** Lead search. Debounced into the shared filters (`q`), so Board and Table search the same text. */
export function LeadsSearch({ className }: { className?: string }) {
  const q = useLeadsViewState((s) => s.filters.q ?? '');
  const setFilters = useLeadsViewState((s) => s.setFilters);
  const w = useLeadWords();
  const [value, setValue] = useState(q);
  const [syncedQ, setSyncedQ] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // External changes (clear filters, saved view) win over the local draft.
  if (q !== syncedQ) {
    setSyncedQ(q);
    setValue(q);
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const commit = (next: string, delay = DEBOUNCE_MS) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const trimmed = next.trim();
      if (trimmed !== (useLeadsViewState.getState().filters.q ?? ''))
        setFilters({ q: trimmed || undefined });
    }, delay);
  };

  return (
    <div className={cn('relative min-w-0', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(value, 0);
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            setValue('');
            commit('', 0);
          }
        }}
        placeholder="Search name, company, phone"
        aria-label={`Search ${w.leads}`}
        className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setValue('');
            commit('', 0);
          }}
          className="focus-ring absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted hover:bg-surface-3 hover:text-fg"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      )}
    </div>
  );
}
