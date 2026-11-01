'use client';

import { SettingsPage } from '@/components/settings/settings-layout';
import { AuditSettings } from '@/components/settings/settings-placeholders';

export default function AuditSettingsPage() {
  return (
    <SettingsPage id="settings-audit" description="A record of sensitive changes: who did what, and when.">
      <AuditSettings />
    </SettingsPage>
  );
}
