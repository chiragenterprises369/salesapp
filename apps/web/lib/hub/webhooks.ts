'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RouteBody, WebhookDelivery, WebhookEndpoint } from '@vistar/shared';
import { api } from '../api/client';
import { isMockData } from '../api/data-source';
import { hubKeys } from './keys';

/** Inbound sources, outbound subscriptions and the delivery log (API mode only, like the hub). */
export function useWebhookEndpoints(opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: hubKeys.webhooks.endpoints(),
    queryFn: ({ signal }) => api.call('webhookEndpointList', { signal, query: {} }),
    enabled: !isMockData(),
    // While a source is capturing a sample, check every 3 s for the captured request.
    refetchInterval: opts.poll ? 3_000 : false,
  });
}

export function useWebhookMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: hubKeys.webhooks.all });
  const put = (e: WebhookEndpoint) => {
    qc.setQueryData<{ items: WebhookEndpoint[] }>(hubKeys.webhooks.endpoints(), (prev) => (prev ? { ...prev, items: prev.items.some((x) => x.id === e.id) ? prev.items.map((x) => (x.id === e.id ? e : x)) : [e, ...prev.items] } : prev));
    return refresh();
  };
  return {
    createInbound: useMutation({ mutationFn: (body: RouteBody<'webhookInboundCreate'>) => api.call('webhookInboundCreate', { body }), onSuccess: (e) => put(e) }),
    createOutbound: useMutation({ mutationFn: (body: RouteBody<'webhookOutboundCreate'>) => api.call('webhookOutboundCreate', { body }), onSuccess: (e) => put(e) }),
    update: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: RouteBody<'webhookEndpointUpdate'> }) => api.call('webhookEndpointUpdate', { params: { id }, body: patch }), onSuccess: put }),
    remove: useMutation({ mutationFn: (id: string) => api.call('webhookEndpointDelete', { params: { id } }), onSuccess: refresh }),
    rotate: useMutation({ mutationFn: ({ id, graceHours }: { id: string; graceHours: number }) => api.call('webhookRotateSecret', { params: { id }, body: { graceHours } }), onSuccess: refresh }),
    capture: useMutation({ mutationFn: ({ id, enabled, minutes }: { id: string; enabled: boolean; minutes?: number }) => api.call('webhookCapture', { params: { id }, body: { enabled, ...(minutes ? { minutes } : {}) } }), onSuccess: put }),
    testSend: useMutation({
      mutationFn: ({ id, event }: { id: string; event?: string }) => api.call('webhookTestSend', { params: { id }, body: event ? { event: event as never } : {} }),
      onSuccess: (d) => {
        qc.setQueryData(hubKeys.webhooks.delivery(d.id), d);
        return refresh();
      },
    }),
    replay: useMutation({
      mutationFn: (id: string) => api.call('webhookDeliveryReplay', { params: { id } }),
      onSuccess: (d) => {
        qc.setQueryData(hubKeys.webhooks.delivery(d.id), d);
        return refresh();
      },
    }),
  };
}

/** Server-side preview of a mapping on a sample payload (the lead it would create, row errors and every path). */
export function useMappingPreview() {
  return useMutation({ mutationFn: (body: RouteBody<'webhookMappingPreview'>) => api.call('webhookMappingPreview', { body }) });
}

export interface DeliveryFilters {
  direction?: 'inbound' | 'outbound';
  status?: WebhookDelivery['status'];
  endpointId?: string;
  event?: string;
  /** ISO instants. */
  from?: string;
  to?: string;
}

const PAGE = 50;

export function useDeliveries(filters: DeliveryFilters) {
  return useInfiniteQuery({
    queryKey: hubKeys.webhooks.deliveries(filters),
    queryFn: ({ pageParam, signal }) => api.call('webhookDeliveryList', { query: { ...filters, cursor: pageParam ?? undefined, limit: PAGE }, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    enabled: !isMockData(),
    // Retrying rows change on the server; the socket covers most of it, this is the fallback.
    refetchInterval: 30_000,
  });
}

/** One delivery; polls every 3 s while it is still pending (a replay or retry in flight). */
export function useDelivery(id: string | null) {
  return useQuery({
    queryKey: hubKeys.webhooks.delivery(id ?? ''),
    queryFn: ({ signal }) => api.call('webhookDeliveryGet', { params: { id: id! }, signal }),
    enabled: !!id && !isMockData(),
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 3_000 : false),
  });
}
