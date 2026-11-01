'use client';

import { DataVisibility } from '@/components/settings/data-visibility';
import { SettingsPage } from '@/components/settings/settings-layout';

export default function DataVisibilitySettingsPage() {
  return (
    <SettingsPage id="settings-visibility" description="Whose leads, tasks, calls and chats each role can see.">
      <DataVisibility />
    </SettingsPage>
  );
}
