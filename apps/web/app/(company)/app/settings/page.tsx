'use client';

import { SettingsPage } from '@/components/settings/settings-layout';
import { WorkspaceForm } from '@/components/settings/workspace-form';

export default function WorkspaceSettingsPage() {
  return (
    <SettingsPage id="settings-workspace" description="Your company name, timezone and what employees can see about rankings.">
      <WorkspaceForm />
    </SettingsPage>
  );
}
