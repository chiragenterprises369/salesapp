'use client';

import { SettingsPage } from '@/components/settings/settings-layout';
import { TemplatesSettings } from '@/components/settings/settings-placeholders';

export default function TemplatesSettingsPage() {
  return (
    <SettingsPage id="settings-templates" description="Approved WhatsApp templates for first messages and follow-ups outside the 24-hour window.">
      <TemplatesSettings />
    </SettingsPage>
  );
}
