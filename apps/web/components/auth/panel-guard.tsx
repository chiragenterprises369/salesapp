'use client';

import { canEnterPanel, homePathFor, type Panel } from '@vistar/shared';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { ShellSkeleton } from '@/components/shell/shell-skeleton';
import { toast } from '@/components/ui/toast';
import { loginPathFor } from '@/lib/auth/redirect';
import { isAuthTransition } from '@/lib/auth/use-auth';
import { usePrincipal, useSessionStatus } from '@/lib/session/session';

/**
 * Client-side panel guard (D-022; the API enforces everything). Used by each panel layout:
 * - session loading: full-page skeleton;
 * - signed out: sign-in page for this panel, with ?next= back to the requested page;
 * - wrong panel for the role: the role's home with a toast.
 */
export function PanelGuard({ panel, children }: { panel: Panel; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const status = useSessionStatus();
  const principal = usePrincipal();
  const allowed = status === 'authenticated' && !!principal && canEnterPanel(principal, panel);

  useEffect(() => {
    if (status === 'loading' || allowed) return;
    // Sign-out and persona switches navigate themselves.
    if (isAuthTransition()) return;
    if (status === 'unauthenticated' || !principal) {
      router.replace(loginPathFor(panel, `${pathname}${window.location.search}`));
      return;
    }
    toast('That area is not available for your role', { id: 'panel-denied' });
    router.replace(homePathFor(principal));
  }, [status, allowed, principal, panel, pathname, router]);

  if (!allowed) return <ShellSkeleton variant={panel === 'company' ? 'company' : panel === 'employee' ? 'employee' : 'super-admin'} />;
  return <>{children}</>;
}
