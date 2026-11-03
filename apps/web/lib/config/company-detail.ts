'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Company, FeatureFlag, PlatformAuditLog } from '@vistar/shared';
import { isRouteLive } from '../api/availability';
import { superApi } from '../api/client';
import { isMockData, noteMockUse } from '../api/data-source';
import { world } from '../world/world';
import { configKeys } from './keys';

/**
 * Super Admin company detail (change #20): one company with its effective flags, usage, custom domain
 * and floor progress (GET /api/super/companies/{id}); flag overrides (PUT .../flags); the company's
 * platform audit entries (GET /api/super/audit-logs?workspaceId=). Mock data mode reads the mock
 * platform world; API mode never shows generated rows.
 */

const pause = (ms = 250) => new Promise((r) => setTimeout(r, ms));

function mockCompany(id: string): Company {
  noteMockUse('super.company');
  const row = world.platform().companies.find((c) => c.company.id === id);
  if (!row) throw Object.assign(new Error('This company does not exist.'), { status: 404 });
  return { ...row.company, userCount: row.users };
}

export function useSuperCompany(id: string) {
  return useQuery({
    queryKey: configKeys.company(id),
    queryFn: async ({ signal }): Promise<Company> => {
      if (isMockData()) {
        await pause();
        return mockCompany(id);
      }
      return superApi.call('superCompanyGet', { params: { id }, signal });
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

/** Set or clear (null) one flag override; the company row comes back with the new effective flags. */
export function useSetCompanyFlag(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ flag, value }: { flag: FeatureFlag; value: boolean | null }): Promise<Company> => {
      if (isMockData()) {
        await pause(200);
        const c = mockCompany(id);
        const overrides = { ...c.flagOverrides };
        if (value === null) delete overrides[flag];
        else overrides[flag] = value;
        return { ...c, flagOverrides: overrides, features: c.features ? { ...c.features, ...(value === null ? {} : { [flag]: value }) } : c.features };
      }
      return superApi.call('superCompanyFlags', { params: { id }, body: { overrides: { [flag]: value } } });
    },
    onSuccess: (company) => {
      qc.setQueryData(configKeys.company(id), company);
      // The Companies list switches read the same flags.
      void qc.invalidateQueries({ queryKey: configKeys.switches });
      void qc.invalidateQueries({ queryKey: ['platform', 'companies'] });
    },
  });
}

/** True when the API this build targets serves the platform audit log. */
export const companyAuditAvailable = () => isMockData() || isRouteLive('superAuditList');

export function useCompanyAudit(id: string) {
  return useInfiniteQuery({
    queryKey: configKeys.companyAudit(id),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<{ items: PlatformAuditLog[]; nextCursor: string | null }> => {
      if (isMockData()) {
        await pause();
        noteMockUse('super.company.audit');
        return { items: world.platform().audit.filter((a) => a.workspaceId === id), nextCursor: null };
      }
      if (!isRouteLive('superAuditList')) return { items: [], nextCursor: null };
      const page = await superApi.call('superAuditList', { query: { workspaceId: id, limit: 50, cursor: pageParam ?? undefined }, signal });
      return { items: page.items, nextCursor: page.nextCursor ?? null };
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!id,
    staleTime: 30_000,
  });
}
