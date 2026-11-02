'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { onRealtimeEvent } from '../realtime/client';

/**
 * Live refresh of the CRM caches while a CRM page is open. The shared realtime client does not map
 * the change #19 wave B events to query scopes yet (lib/realtime/logic.ts belongs to WEB-API), so this
 * hook listens to the raw events and invalidates by prefix, debounced and deferred while a mutation
 * runs (the same rule the realtime client uses, so optimistic moves are not overwritten mid-flight).
 */
const PREFIX_SCOPES: Record<string, readonly string[]> = {
  contact: ['contacts', 'accounts', 'deals'],
  account: ['accounts', 'contacts', 'deals'],
  deal: ['deals', 'contacts', 'accounts'],
  quotation: ['quotations', 'deals', 'contacts', 'accounts'],
  invoice: ['invoices', 'quotations', 'deals', 'contacts', 'accounts'],
  catalog: ['products'],
  meeting: ['calendar', 'contacts', 'accounts', 'deals'],
  lead: ['contacts', 'accounts'],
};

export function scopesForCrmEvent(type: string): readonly string[] {
  return PREFIX_SCOPES[type.split('.')[0] ?? ''] ?? [];
}

export function useCrmRealtime(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const stale = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      if (qc.isMutating() > 0) {
        timer = setTimeout(flush, 400);
        return;
      }
      const scopes = [...stale];
      stale.clear();
      scopes.forEach((s) => void qc.invalidateQueries({ queryKey: [s] }));
    };
    const off = onRealtimeEvent((event) => {
      const scopes = scopesForCrmEvent(event.type);
      if (!scopes.length) return;
      scopes.forEach((s) => stale.add(s));
      if (!timer) timer = setTimeout(flush, 400);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [qc]);
}
