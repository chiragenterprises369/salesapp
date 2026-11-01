import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PanelGuard } from '@/components/auth/panel-guard';
import { ServiceWorkerRegister } from '@/components/employee/sw-register';
import { EmployeeShell } from '@/components/shell/employee-shell';

/** The Employee panel is the installable app (PWA, start_url /me). */
export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Vistar', statusBarStyle: 'default' },
};

/** Employee panel (/me): employees, and managers for their own work. */
export default function EmployeeLayout({ children }: { children: ReactNode }) {
  return (
    <PanelGuard panel="employee">
      <EmployeeShell>{children}</EmployeeShell>
      <ServiceWorkerRegister />
    </PanelGuard>
  );
}
