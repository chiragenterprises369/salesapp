'use client';

import { SettingsPage } from '@/components/settings/settings-layout';
import { TagsSettings } from '@/components/settings/settings-placeholders';

export default function TagsSettingsPage() {
  return (
    <SettingsPage id="settings-tags" description="Labels that group leads across stages.">
      <TagsSettings />
    </SettingsPage>
  );
}
