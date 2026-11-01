'use client';

import type { ReactNode } from 'react';
import { AppQueryProvider } from './query-client';
import { SessionProvider } from './session/session';

/**
 * Root client providers shared by every route. OWNER: orchestrator.
 * frontend-app adds its theme provider and toaster wiring in app/layout.tsx around/inside this.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AppQueryProvider>
      <SessionProvider>{children}</SessionProvider>
    </AppQueryProvider>
  );
}
