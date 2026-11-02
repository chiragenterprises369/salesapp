'use client';

import { useQuery } from '@tanstack/react-query';
import { isCustomHost } from './boot';
import type { CustomDomain, WorkspaceBranding } from './types';
import { readBranding } from './workspace-branding';

/**
 * Branding for signed-out pages on a company's custom domain (sign-in, sign-up, invite).
 * The PLATFORM resolve-host route maps the request host to a workspace and returns its public
 * branding (display name, logos, brand colour, sign-in image, favicon). Nothing private.
 *
 * ADAPTER until contracts-19: the mock session's saved workspace answers for its verified domain,
 * so `crm.<company>.localhost:3001/login` shows the company's sign-in page locally.
 * TODO(contracts-19): GET the resolve-host route instead of reading the mock store.
 */
export type PublicBranding = Pick<WorkspaceBranding, 'displayName' | 'logoLightUrl' | 'logoDarkUrl' | 'faviconUrl' | 'loginImageUrl' | 'brandColor' | 'chartPalette'> & {
  workspaceName: string;
};

function mockResolveHost(host: string): PublicBranding | null {
  try {
    const raw = window.localStorage.getItem('vistar.mock.workspace');
    if (!raw) return null;
    const ws = JSON.parse(raw) as { name?: string; customDomain?: CustomDomain | null };
    const domain = ws.customDomain;
    if (!domain || domain.status !== 'verified' || domain.hostname.toLowerCase() !== host.toLowerCase()) return null;
    const b = readBranding({ logoUrl: null, accentColor: null, ...(ws as object) } as never);
    return { ...b, workspaceName: ws.name ?? b.displayName ?? 'Vistar' };
  } catch {
    return null;
  }
}

export async function resolveHostBranding(host: string): Promise<PublicBranding | null> {
  if (!isCustomHost(host)) return null;
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
  });
}
