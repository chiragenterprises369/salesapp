'use client';

import { homePathFor } from '@vistar/shared';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ShellSkeleton } from '@/components/shell/shell-skeleton';
import { LOGIN_PATH } from '@/lib/auth/redirect';
import { usePrincipal, useSessionStatus } from '@/lib/session/session';

/** "/": signed in -> the role's home panel, otherwise the sign-in page. */
export default function RootPage() {
  const router = useRouter();
  const status = useSessionStatus();
  const principal = usePrincipal();

  useEffect(() => {
    if (status === 'loading') return;
    router.replace(status === 'authenticated' && principal ? homePathFor(principal) : LOGIN_PATH);
  }, [status, principal, router]);

  return <ShellSkeleton variant="plain" />;
}
