'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { DomainEvent, WebhookDelivery } from '@vistar/shared';
import { useEffect } from 'react';
import { onRealtimeEvent } from '../realtime/client';
import { hubKeys } from './keys';
import { scopesForHubEvent } from './rules';

/**
 * Live refresh while a hub page is open. A delivery update replaces the cached delivery at once
 * (the open detail drawer shows the new status without a refetch); lists refetch debounced and
 * wait for running mutations, like the CRM pages.
 */
export function useHubRealtime(): void {
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
    const off = onRealtimeEvent((event: DomainEvent) => {
      if (event.type === 'webhook.delivery_updated') {
        const delivery = (event as DomainEvent<'webhook.delivery_updated'>).payload.delivery as WebhookDelivery;
        qc.setQueryData(hubKeys.webhooks.delivery(delivery.id), delivery);
      }
      const scopes = scopesForHubEvent(event.type);
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
