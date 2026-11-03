'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiKey, RouteBody } from '@vistar/shared';
import { api } from '../api/client';
import { isMockData } from '../api/data-source';
import { hubKeys } from './keys';

/** Settings > API keys: list, scope picker, create (shown once), rename and rate limit, rotate, revoke. */
export function useApiKeys() {
  return useQuery({ queryKey: hubKeys.apiKeys.list(), queryFn: ({ signal }) => api.call('apiKeyList', { signal }), enabled: !isMockData() });
}

export function useApiKeyScopes() {
  return useQuery({ queryKey: hubKeys.apiKeys.scopes(), queryFn: ({ signal }) => api.call('apiKeyScopes', { signal }), enabled: !isMockData(), staleTime: 5 * 60_000 });
}

export function useApiKeyMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: hubKeys.apiKeys.all });
  const put = (k: ApiKey) => {
    qc.setQueryData<{ items: ApiKey[] }>(hubKeys.apiKeys.list(), (prev) => (prev ? { ...prev, items: prev.items.some((x) => x.id === k.id) ? prev.items.map((x) => (x.id === k.id ? k : x)) : [k, ...prev.items] } : prev));
    return refresh();
  };
  return {
    create: useMutation({
      mutationFn: (body: RouteBody<'apiKeyCreate'>) => api.call('apiKeyCreate', { body }),
      onSuccess: ({ key: _plain, ...k }) => put(k),
    }),
    update: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: RouteBody<'apiKeyUpdate'> }) => api.call('apiKeyUpdate', { params: { id }, body: patch }), onSuccess: put }),
    rotate: useMutation({
      mutationFn: ({ id, graceMinutes }: { id: string; graceMinutes: number }) => api.call('apiKeyRotate', { params: { id }, body: { graceMinutes } }),
      onSuccess: ({ key: _plain, ...k }) => put(k),
    }),
    revoke: useMutation({ mutationFn: (id: string) => api.call('apiKeyRevoke', { params: { id } }), onSuccess: refresh }),
  };
}
