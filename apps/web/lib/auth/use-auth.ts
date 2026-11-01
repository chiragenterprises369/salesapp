'use client';

import { homePathFor } from '@vistar/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { usePrincipal, useMe, useSessionActions, useSessionStatus, type MockPersona } from '@/lib/session/session';
import { LOGIN_PATH, safeNextPath } from './redirect';

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

/**
 * Set when the user signs out or switches persona on purpose, so panel guards do not race that
 * navigation with their own redirect (and do not show a "not available" toast).
 */
let authTransitionAt = 0;
export function isAuthTransition(): boolean {
  return Date.now() - authTransitionAt < 3_000;
}

/** Sign out and go to `to` (default: workspace sign-in). */
export function useSignOut() {
  const router = useRouter();
  const { signOut } = useSessionActions();
  return useCallback(
    (to: string = LOGIN_PATH) => {
      authTransitionAt = Date.now();
      router.replace(to);
      signOut();
    },
    [router, signOut],
  );
}

/** Development: become another mock persona and open its home panel. */
export function useSwitchPersona() {
  const router = useRouter();
  const { signInMock } = useSessionActions();
  return useCallback(
    (persona: MockPersona, opts: { impersonating?: boolean } = {}) => {
      authTransitionAt = Date.now();
      const home = homePathFor(persona === 'super_admin' ? { audience: 'platform' } : { audience: 'workspace', kind: persona });
      router.replace(home);
      signInMock(persona, opts);
    },
    [router, signInMock],
  );
}
