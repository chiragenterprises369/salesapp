'use client';

import type { Workspace, WorkspaceUpdate } from '@vistar/shared';
import { useCallback } from 'react';
import { useMe, useSessionActions } from '@/lib/session/session';
import { readCompanySwitches } from './platform-config';
import type { CustomDomain } from './types';
import { readCustomDomain } from './workspace-branding';

/**
 * Custom domain for a company (SPEC 29.4, D-060): only when the Super Admin switched it on for the
 * company (feature `custom_domain`). The company adds a CNAME to Vistar and a TXT record that proves
 * ownership; Verify checks both; then the host resolves to the workspace (sign-in page branding).
 *
 * ADAPTER until contracts-19: state on the session's workspace (me.workspace.customDomain), the switch
 * from the mock platform store, and a local check that verifies `*.localhost` names (browsers send
 * them to 127.0.0.1 without DNS) and reports the TXT record as missing for real domains.
 * TODO(contracts-19): PUT/DELETE the domain and POST verify on the workspace domain routes.
 */

export const CNAME_TARGET = process.env.NEXT_PUBLIC_CNAME_TARGET || 'domains.vistar.app';
const TXT_PREFIX = '_vistar-verify';

export function customDomainEnabled(ws: Workspace | null | undefined): boolean {
  if (!ws) return false;
  const flag = (ws.features as Record<string, boolean | undefined>).custom_domain;
  if (typeof flag === 'boolean') return flag;
  if (typeof window === 'undefined') return false;
  return readCompanySwitches(ws.id).customDomain;
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Hostname rules: lower case labels, no IP addresses, a sub-domain (CNAME cannot sit on the apex) or `*.localhost`. */
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
  if (!local && (hostname.endsWith('.vistar.app') || hostname === CNAME_TARGET)) return { hostname, error: 'This address belongs to Vistar. Use your own domain.' };
  return { hostname, error: null };
}

function token(workspaceId: string, hostname: string): string {
  // Deterministic in the adapter; the API issues a random token.
  let h = 2166136261;
  for (const ch of `${workspaceId}:${hostname}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0') + workspaceId.replace(/-/g, '').slice(-12);
}

export function domainRecords(workspaceId: string, hostname: string): Pick<CustomDomain, 'cnameTarget' | 'txtName' | 'txtValue'> {
  return { cnameTarget: CNAME_TARGET, txtName: `${TXT_PREFIX}.${hostname}`, txtValue: `vistar-verify=${token(workspaceId, hostname)}` };
}

export function useCustomDomain() {
  const me = useMe();
  const { updateWorkspace } = useSessionActions();
  const domain = readCustomDomain(me?.workspace);
  const enabled = customDomainEnabled(me?.workspace);

  const save = useCallback((customDomain: CustomDomain | null) => updateWorkspace({ customDomain } as unknown as WorkspaceUpdate), [updateWorkspace]);

  const setHostname = useCallback(
    async (hostname: string) => {
      if (!me) return;
      await save({ hostname, status: 'pending', ...domainRecords(me.workspace.id, hostname), lastCheckedAt: null, error: null });
    },
    [me, save],
  );

  const verify = useCallback(async () => {
    if (!domain) return null;
    await new Promise((r) => setTimeout(r, 700));
    const local = domain.hostname.endsWith('.localhost');
    const next: CustomDomain = {
      ...domain,
      status: local ? 'verified' : 'failed',
      lastCheckedAt: new Date().toISOString(),
      error: local ? null : `No TXT record ${domain.txtName} was found yet. DNS changes can take up to 48 hours; check the record and try again.`,
    };
    await save(next);
    return next;
  }, [domain, save]);

  const remove = useCallback(() => save(null), [save]);

  return { enabled, domain, setHostname, verify, remove };
}
