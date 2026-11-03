import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

// ---- change #20: prod
/** Read VISTAR_DEV_ROUTES at request time, not at build time. */
export const dynamic = 'force-dynamic';

/**
 * Dev previews (/kit, /dev/*) are off in production builds unless VISTAR_DEV_ROUTES=1 is set on the server
 * (for example on a staging box). They use mock personas and fixtures, never real data.
 */
export default function DevLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production' && process.env.VISTAR_DEV_ROUTES !== '1') notFound();
  return children;
}
// ---- end change #20: prod
