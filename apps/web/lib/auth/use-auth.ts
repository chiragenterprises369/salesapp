'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { usePrincipal, useMe, useSessionStatus } from '@/lib/session/session';
import { safeNextPath } from './redirect';

/**
 * Auth pages: once a session exists (just signed in, or already signed in), go to `next` or the role's
 * home. `audience` limits it to one kind of session (the Super Admin sign-in page ignores workspace sessions).
 */
export function useRedirectWhenSignedIn(next: string | null, audience?: 'workspace' | 'platform') {
  const router = useRouter();
  const status = useSessionStatus();
  const principal = usePrincipal();
  const matches = !!principal && (!audience || principal.audience === audience);
  useEffect(() => {
    if (status === 'authenticated' && principal && matches) router.replace(safeNextPath(next, principal));
  }, [status, principal, matches, next, router]);
  return status === 'authenticated' && matches ? 'authenticated' : status === 'loading' ? 'loading' : 'unauthenticated';
}

/**
 * Read-only state while a Super Admin is viewing the company (impersonation). The API blocks every
 * write; the UI disables save buttons and says why.
 */
export function useReadOnly(): { readOnly: boolean; reason: string | null } {
  const me = useMe();
  const readOnly = !!me?.impersonation?.readOnly;
  return { readOnly, reason: readOnly ? 'Read-only support session. Changes are turned off.' : null };
}
