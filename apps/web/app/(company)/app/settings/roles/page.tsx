'use client';

import { RolesEditor } from '@/components/settings/roles-editor';
import { SettingsPage } from '@/components/settings/settings-layout';

export default function RolesSettingsPage() {
  return (
    <SettingsPage id="settings-roles" description="Decide what each role can do and whose records it can see. Changes reach people within 15 minutes, when their session refreshes.">
      <RolesEditor />
    </SettingsPage>
  );
}
