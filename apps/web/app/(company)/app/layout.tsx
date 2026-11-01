import type { ReactNode } from 'react';
import { PanelGuard } from '@/components/auth/panel-guard';
import { CompanyShell } from '@/components/shell/company-shell';

/** Company panel (/app): company_admin, manager, viewer. Guarded client-side; the API enforces access. */
export default function CompanyLayout({ children }: { children: ReactNode }) {
  return (
    <PanelGuard panel="company">
      <CompanyShell>{children}</CompanyShell>
    </PanelGuard>
  );
}
