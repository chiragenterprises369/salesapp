'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  DEFAULT_LABELS,
  labelNavItem,
  withNavLabels,
  withObjectNavigation,
  withPackEmployeeNavigation,
  withPackNavigation,
  type NavGroup,
  type NavItem,
  type PackInstallRequest,
} from '@vistar/shared';
import type { z } from 'zod';
import type { SuperPackCompanyUpdateSchema, SuperPackPlansUpdateSchema } from '@vistar/shared';
import { useCallback } from 'react';
import { customizationKeys } from '../customization/hooks';
import { useMe } from '../session/session';
import { getPacksSource } from './source';

/** Query keys: company side under 'customization' (refreshed by customization.changed / pack.*), Super Admin under 'super'. */
export const packKeys = {
  list: () => ['customization', 'packs'] as const,
  plan: (key: string, action: string, modes: readonly string[] | undefined) => ['customization', 'packs', key, 'plan', action, modes ?? null] as const,
  log: (key: string) => ['customization', 'packs', key, 'log'] as const,
  superList: () => ['super', 'packs'] as const,
  superVersion: (key: string, version: string) => ['super', 'packs', key, 'version', version] as const,
  superUsage: (key: string) => ['super', 'packs', key, 'usage'] as const,
};

const src = () => getPacksSource();

/** Active pack extensions for the signed-in workspace user (labels, nav, widgets, objects, ...). */
export function usePackRuntime() {
  const me = useMe();
  return useQuery({ queryKey: customizationKeys.runtime(), queryFn: () => src().runtime(), enabled: !!me, staleTime: 5 * 60_000 });
}

/**
 * Nav composition for shells: custom objects (showInNav) after Leads, pack pages in their group,
 * configurable labels applied. Filter the result with visibleNav() as before.
 */
export function useNavExtensions() {
  const rt = usePackRuntime().data;
  const me = useMe();
  const labels = rt?.labels ?? me?.labels ?? DEFAULT_LABELS;
  const company = useCallback(
    (groups: readonly NavGroup[]): NavGroup[] => withNavLabels(withPackNavigation(withObjectNavigation(groups, rt?.objects ?? []), rt?.navigation ?? []), labels),
    [rt, labels],
  );
  const employeeMore = useCallback(
    (items: readonly NavItem[]): NavItem[] => withPackEmployeeNavigation(items, rt?.navigation ?? []).map((i) => labelNavItem(i, labels)),
    [rt, labels],
  );
  const employeeBottom = useCallback((items: readonly NavItem[]): NavItem[] => items.map((i) => labelNavItem(i, labels)), [labels]);
  return { company, employeeMore, employeeBottom, labels, ready: !!rt };
}

// ---------------------------------------------------------------- Settings > Industry

const afterPackChange = (qc: QueryClient) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: customizationKeys.all }),
    qc.invalidateQueries({ queryKey: ['records'] }),
    qc.invalidateQueries({ queryKey: ['board'] }),
    qc.invalidateQueries({ queryKey: ['leads'] }),
  ]);

export function usePacks() {
  return useQuery({ queryKey: packKeys.list(), queryFn: () => src().list() });
}

/** Dry run preview (nothing is written). */
export function usePackPlan(key: string | null, action: 'install' | 'upgrade' | 'uninstall', modes?: readonly string[]) {
  return useQuery({ queryKey: packKeys.plan(key ?? '', action, modes), queryFn: () => src().plan(key!, action, modes ? [...modes] : undefined), enabled: !!key, staleTime: 0 });
}

export function usePackLog(key: string | null) {
  return useQuery({ queryKey: packKeys.log(key ?? ''), queryFn: () => src().log(key!), enabled: !!key });
}

export function useInstallPack() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ key, body }: { key: string; body?: PackInstallRequest }) => src().install(key, body), onSuccess: () => afterPackChange(qc) });
}
export function useUpgradePack() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (key: string) => src().upgrade(key), onSuccess: () => afterPackChange(qc) });
}
export function useUninstallPack() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (key: string) => src().uninstall(key), onSuccess: () => afterPackChange(qc) });
}

// ---------------------------------------------------------------- Super Admin registry

export function useSuperPacks() {
  return useQuery({ queryKey: packKeys.superList(), queryFn: () => src().super.list() });
}
export function useSuperPackVersion(key: string | null, version: string | null) {
  return useQuery({ queryKey: packKeys.superVersion(key ?? '', version ?? ''), queryFn: () => src().super.version(key!, version!), enabled: !!key && !!version });
}
export function usePackUsage(key: string | null) {
  return useQuery({ queryKey: packKeys.superUsage(key ?? ''), queryFn: () => src().super.usage(key!), enabled: !!key });
}
export function useSetPackPlans() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, body }: { key: string; body: z.input<typeof SuperPackPlansUpdateSchema> }) => src().super.setPlans(key, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['super', 'packs'] }),
  });
}
export function useSetPackCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, workspaceId, body }: { key: string; workspaceId: string; body: z.input<typeof SuperPackCompanyUpdateSchema> }) => src().super.setCompany(key, workspaceId, body),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['super', 'packs'] }), afterPackChange(qc)]),
  });
}
