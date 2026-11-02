'use client';

import type { ComponentStyle, CustomDomain, HostResolution, WorkspaceBranding } from '@vistar/shared';
import { useQuery } from '@tanstack/react-query';
import { isCustomHost } from './boot';
import { api } from './http';
import type { BrandingDraft } from './types';
import { brandingToDraft } from './workspace-branding';

/**
 * Branding for signed-out pages on a company's custom domain or `<slug>.localhost` (sign-in, sign-up,
 * invite): GET /public/resolve-host?host=<host> (no auth) returns the public workspace (name, branding,
 * component style). Nothing private.
 * Mock layer (NEXT_PUBLIC_DATA_SOURCE=mock, or the API cannot answer): the mock workspace answers for
 * its verified domain, so the flow can be tried in the browser without the API.
 */
export type PublicBranding = BrandingDraft & { workspaceName: string; componentStyle: ComponentStyle };

function mockResolveHost(host: string): PublicBranding | null {
  try {
    const raw = window.localStorage.getItem('vistar.mock.workspace');
    if (!raw) return null;
    const ws = JSON.parse(raw) as { name?: string; branding?: WorkspaceBranding; componentStyle?: ComponentStyle; customDomain?: CustomDomain | null };
    const domain = ws.customDomain;
    if (!domain || domain.status !== 'verified' || domain.hostname.toLowerCase() !== host.toLowerCase()) return null;
    const draft = brandingToDraft(ws.branding);
    return { ...draft, workspaceName: draft.displayName ?? ws.name ?? 'Vistar', componentStyle: ws.componentStyle ?? 'standard' };
  } catch {
    return null;
  }
}

export async function resolveHostBranding(host: string): Promise<PublicBranding | null> {
  if (!isCustomHost(host)) return null;
  if (process.env.NEXT_PUBLIC_DATA_SOURCE !== 'mock') {
    try {
      const r = await api<HostResolution>(`/public/resolve-host?host=${encodeURIComponent(host)}`, { auth: false });
      const draft = brandingToDraft(r.workspace.branding);
      return { ...draft, workspaceName: r.workspace.name, componentStyle: r.workspace.componentStyle };
    } catch {
      /* unknown host or API not reachable: try the mock store */
    }
  }
  return mockResolveHost(host);
}

/** Public branding for this host; null on Vistar's own hosts or an unknown domain. */
export function usePublicBranding(enabled = true) {
  const host = typeof window === 'undefined' ? '' : window.location.hostname;
  return useQuery({
    queryKey: ['branding', 'public', host],
    queryFn: () => resolveHostBranding(host),
    enabled: enabled && !!host && isCustomHost(host),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
