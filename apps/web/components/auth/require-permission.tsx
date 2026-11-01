'use client';

import { homePathFor } from '@vistar/shared';
import { Lock } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { useMe, usePermissions, usePrincipal } from '@/lib/session/session';

/**
 * Renders children only if the user has ANY of `anyOf` (same rule as NavItem.anyOf). Direct URL hits
 * without permission get a "No access" state with a way back; the API still enforces access.
 */
export function RequirePermission({ anyOf, children }: { anyOf: readonly string[]; children: ReactNode }) {
  const permissions = usePermissions();
  if (anyOf.length > 0 && !anyOf.some((p) => permissions.includes(p))) return <NoAccess />;
  return <>{children}</>;
}

export function NoAccess() {
  const me = useMe();
  const principal = usePrincipal();
  const home = principal ? homePathFor(principal) : '/';
  return (
    <EmptyState
      icon={<Lock />}
      title="You do not have access to this page"
      description={
        me
          ? `Your role (${me.role.name}) does not include this area. Ask a company admin to change your role if you need it.`
          : 'Your account does not include this area.'
      }
      action={
        <Button asChild variant="primary">
          <Link href={home}>Go to your home page</Link>
        </Button>
      }
    />
  );
}
