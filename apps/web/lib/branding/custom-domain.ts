'use client';

import { CUSTOM_DOMAIN_TXT_PREFIX, CUSTOM_DOMAIN_TXT_VALUE_PREFIX, type CustomDomain, type CustomDomainState, type Workspace, type WorkspaceUpdate } from '@vistar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMe, useSessionActions } from '@/lib/session/session';
import { api, apiMode } from './http';
import { readCompanySwitches } from './platform-config';

/**
 * Custom domain for a company (SPEC 29.4, D-060), only when the Super Admin switched `custom_domain`
 * on for it. The company adds a CNAME to Vistar and a TXT record proving ownership; Verify checks
 * them; then the host resolves to the workspace (sign-in page branding).
 *
 * API: GET/PUT/DELETE /workspace/domain, POST /workspace/domain/verify (CustomDomainState).
 * Mock layer: state on the mock workspace (`customDomain`), the switch from the mock platform store,
 * and a local check that verifies `*.localhost` names (as the API does in development) and reports
 * the TXT record as missing for real domains.
 */

export const CNAME_TARGET = process.env.NEXT_PUBLIC_CNAME_TARGET || 'localhost';
const KEY = ['workspace', 'domain'] as const;

type MockWorkspace = Workspace & { customDomain?: CustomDomain | null };

/** Effective switch: the workspace flag (API) or the Super Admin switch in the mock store. */
export function customDomainEnabled(ws: Workspace | null | undefined): boolean {
  if (!ws) return false;
  if (apiMode()) return !!ws.features.custom_domain;
  if (typeof window === 'undefined') return false;
  return readCompanySwitches(ws.id).customDomain;
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Hostname rules (the API validates with HostnameSchema too): labels, no IP or port, a sub-domain or `*.localhost`. */
export function validateHostname(input: string): { hostname: string; error: string | null } {
  const hostname = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  if (!hostname) return { hostname, error: 'Enter the address people will use, for example crm.yourcompany.com.' };
  if (hostname.length > 253) return { hostname, error: 'That address is too long.' };
  if (/^\d+(\.\d+){3}$/.test(hostname) || hostname.includes(':')) return { hostname, error: 'Use a name, not an IP address or port.' };
  const labels = hostname.split('.');
  if (!labels.every((l) => LABEL.test(l))) return { hostname, error: 'Use letters, numbers and hyphens only, separated by dots.' };
  const local = labels.at(-1) === 'localhost';
  if (local && labels.length < 2) return { hostname, error: 'Add a name before .localhost, for example shakti.localhost.' };
  if (!local && labels.length < 3) return { hostname, error: 'Use a sub-domain such as crm.yourcompany.com; the bare domain cannot point to Vistar with a CNAME.' };
  if (!local && hostname.endsWith('.vistar.app')) return { hostname, error: 'This address belongs to Vistar. Use your own domain.' };
  return { hostname, error: null };
}

function mockToken(workspaceId: string, hostname: string): string {
  let h = 2166136261;
  for (const ch of `${workspaceId}:${hostname}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0') + workspaceId.replace(/-/g, '').slice(-12);
}

function mockDomain(ws: Workspace, hostname: string): CustomDomain {
  return {
    id: crypto.randomUUID(),
    hostname,
    status: 'pending',
    verifiedAt: null,
    lastCheckedAt: null,
    lastError: null,
    dns: {
      cname: { name: hostname, value: CNAME_TARGET },
      txt: { name: `${CUSTOM_DOMAIN_TXT_PREFIX}.${hostname}`, value: `${CUSTOM_DOMAIN_TXT_VALUE_PREFIX}${mockToken(ws.id, hostname)}` },
    },
    createdAt: new Date().toISOString(),
  };
}

export function useCustomDomain() {
  const me = useMe();
  const { updateWorkspace } = useSessionActions();
  const qc = useQueryClient();
  const live = apiMode();
  const ws = me?.workspace as MockWorkspace | undefined;

  const query = useQuery({
    queryKey: KEY,
    enabled: !!me,
    queryFn: async (): Promise<CustomDomainState> => {
      if (live) return api<CustomDomainState>('/workspace/domain');
      return { enabled: customDomainEnabled(ws), domain: ws?.customDomain ?? null };
    },
  });

  const saveMock = async (customDomain: CustomDomain | null): Promise<CustomDomainState> => {
    await updateWorkspace({ customDomain } as unknown as WorkspaceUpdate);
    return { enabled: customDomainEnabled(ws), domain: customDomain };
  };

  const onDone = (s: CustomDomainState) => qc.setQueryData(KEY, s);

  const setHostname = useMutation({
    mutationFn: (hostname: string) => (live ? api<CustomDomainState>('/workspace/domain', { method: 'PUT', json: { hostname } }) : saveMock(mockDomain(ws!, hostname))),
    onSuccess: onDone,
  });
  const verify = useMutation({
    mutationFn: async (): Promise<CustomDomainState> => {
      if (live) return api<CustomDomainState>('/workspace/domain/verify', { method: 'POST' });
      const d = query.data?.domain;
      if (!d) return { enabled: true, domain: null };
      await new Promise((r) => setTimeout(r, 600));
      const local = d.hostname.endsWith('.localhost');
      const now = new Date().toISOString();
      return saveMock({
        ...d,
        status: local ? 'verified' : 'failed',
        verifiedAt: local ? now : null,
        lastCheckedAt: now,
        lastError: local ? null : `No TXT record ${d.dns.txt.name} was found yet. DNS changes can take up to 48 hours; check the record and try again.`,
      });
    },
    onSuccess: onDone,
  });
  const remove = useMutation({
    mutationFn: () => (live ? api<CustomDomainState>('/workspace/domain', { method: 'DELETE' }) : saveMock(null)),
    onSuccess: onDone,
  });

  return { query, enabled: query.data?.enabled ?? false, domain: query.data?.domain ?? null, setHostname, verify, remove };
}
