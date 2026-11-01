'use client';

import { IndustrySettings } from '@/components/packs/industry/industry-settings';
import { SettingsPage } from '@/components/settings/settings-layout';

export default function IndustrySettingsPage() {
  return (
    <SettingsPage id="settings-industry" description="Industry packs adapt Vistar to how your business sells: extra fields, records, pipelines and pages.">
      <IndustrySettings />
    </SettingsPage>
  );
}
