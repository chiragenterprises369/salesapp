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
    // Sync times and "last checked" move on the server; refresh quietly while the page is open.
    refetchInterval: 60_000,
  });
}

/** Provider catalog: connect fields, setup steps, capabilities, availability on this server, plan feature. */
export function useIntegrationCatalog() {
  return useQuery({
    queryKey: hubKeys.integrations.catalog(),
    queryFn: ({ signal }) => api.call('integrationCatalog', { signal }),
    enabled: !isMockData(),
    staleTime: 10 * 60_000,
  });
}

export function useIntegrationMutations() {
  const qc = useQueryClient();
  /** Put the fresh row in the list cache, then refetch in the background. */
  const put = (i: Integration) => {
    qc.setQueryData<{ items: Integration[] }>(hubKeys.integrations.list(), (prev) => (prev ? { ...prev, items: prev.items.map((x) => (x.provider === i.provider ? i : x)) } : prev));
    return qc.invalidateQueries({ queryKey: hubKeys.integrations.list() });
  };
  return {
    connect: useMutation({
      mutationFn: ({ provider, body }: { provider: Integration['provider']; body: RouteBody<'integrationConnect'> }) => api.call('integrationConnect', { params: { provider }, body }),
      onSuccess: put,
    }),
    test: useMutation({
      mutationFn: ({ provider, to }: { provider: Integration['provider']; to?: string }) => api.call('integrationTest', { params: { provider }, body: to ? { to } : {} }),
      onSuccess: (r) => put(r.integration),
    }),
    sync: useMutation({
      mutationFn: (provider: Integration['provider']) => api.call('integrationSync', { params: { provider } }),
      onSuccess: (r) => put(r.integration),
    }),
    oauthStart: useMutation({ mutationFn: (provider: Integration['provider']) => api.call('integrationOAuthStart', { params: { provider } }) }),
    rotateToken: useMutation({ mutationFn: (provider: Integration['provider']) => api.call('integrationRotateToken', { params: { provider } }), onSuccess: put }),
    disconnect: useMutation({
      mutationFn: (provider: Integration['provider']) => api.call('integrationDisconnect', { params: { provider } }),
      onSuccess: () => qc.invalidateQueries({ queryKey: hubKeys.integrations.all }),
    }),
  };
}
