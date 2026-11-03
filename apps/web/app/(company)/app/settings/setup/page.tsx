'use client';

import { SettingsPage } from '@/components/settings/settings-layout';
import { SetupChecklistPage } from '@/components/setup/setup-checklist';

export default function SetupSettingsPage() {
  return (
    <SettingsPage id="settings-setup" description="Everything your company should set up, with what is done and a link to finish the rest.">
      <SetupChecklistPage />
    </SettingsPage>
  );
}
