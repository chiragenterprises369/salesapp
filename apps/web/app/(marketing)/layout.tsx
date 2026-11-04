import type { ReactNode } from 'react';

/** Marketing pages: landing, pricing, etc. No auth shell. */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
