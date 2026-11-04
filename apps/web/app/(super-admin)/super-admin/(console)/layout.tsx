import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PanelGuard } from '@/components/auth/panel-guard';
import { SuperAdminShell } from '@/components/shell/super-admin-shell';

export const metadata: Metadata = { title: { default: 'Platform', template: '%s · Platform · Tootodo' }, robots: { index: false } };

/** Super Admin console: platform sessions only (separate audience, 2FA, idle timeout). */
export default function SuperAdminConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <PanelGuard panel="super-admin">
      <SuperAdminShell>{children}</SuperAdminShell>
    </PanelGuard>
  );
}
