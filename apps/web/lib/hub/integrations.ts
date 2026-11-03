'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Integration, RouteBody } from '@vistar/shared';
import { api } from '../api/client';
import { isMockData } from '../api/data-source';
import { hubKeys } from './keys';

/**
 * Integration hub data (IndiaMART, WhatsApp Cloud API, telephony, SMTP, Google Calendar) on the
 * typed API client. API mode only: the test-only mock data mode has no integration data, so the
 * hooks stay idle there and the page says so.
 */
export function useIntegrations() {
  return useQuery({
    queryKey: hubKeys.integrations.list(),
    queryFn: ({ signal }) => api.call('integrationList', { signal }),
    enabled: !isMockData(),
    // Sync status and "last checked" move on the server; refresh quietly while the page is open.
    refetchInterval: 60_000,
  });
}

export function useIntegrationMutations() {
  const qc = useQueryClient();
  const put = (i: Integration) => {
    qc.setQueryData<{ items: Integration[] }>(hubKeys.integrations.list(), (prev) => (prev ? { ...prev, items: prev.items.map((x) => (x.provider === i.provider ? i : x)).concat(prev.items.some((x) => x.provider === i.provider) ? [] : [i]) } : prev));
    return qc.invalidateQueries({ queryKey: hubKeys.integrations.all });
  };
  const refresh = () => qc.invalidateQueries({ queryKey: hubKeys.integrations.all });
  return {
    connect: useMutation({
      mutationFn: ({ provider, body }: { provider: string; body: RouteBody<'integrationConnect'> }) => api.call('integrationConnect', { params: { provider }, body }),
      onSuccess: put,
    }),
    test: useMutation({ mutationFn: (provider: string) => api.call('integrationTest', { params: { provider } }), onSettled: refresh }),
    disconnect: useMutation({ mutationFn: (provider: string) => api.call('integrationDisconnect', { params: { provider } }), onSuccess: refresh }),
  };
}
