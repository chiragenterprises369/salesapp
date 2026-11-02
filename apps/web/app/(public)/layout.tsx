import type { ReactNode } from 'react';

/** Public pages (hosted capture forms, shared documents): no panel shell, no sign-in. */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <main className="min-h-dvh bg-bg px-4 py-6 sm:px-6 sm:py-10">{children}</main>;
}
