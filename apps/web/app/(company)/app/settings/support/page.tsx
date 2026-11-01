'use client';

import { SettingsPage } from '@/components/settings/settings-layout';
import { SupportAccessForm } from '@/components/settings/support-access-form';

export default function SupportAccessSettingsPage() {
  return (
    <SettingsPage id="settings-support" description="Let Vistar support look at your workspace for a limited time when you ask for help.">
      <SupportAccessForm />
    </SettingsPage>
  );
}
