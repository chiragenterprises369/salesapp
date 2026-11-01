'use client';

import { LabelsSettings } from '@/components/settings/labels/labels-settings';
import { SettingsPage } from '@/components/settings/settings-layout';

export default function LabelsSettingsPage() {
  return (
    <SettingsPage id="settings-labels" description="Rename Leads, Deals and other core words to match how your business talks, for example Enquiries instead of Leads.">
      <LabelsSettings />
    </SettingsPage>
  );
}
