'use client';

import { SettingsPage } from '@/components/settings/settings-layout';
import { StagesSettings } from '@/components/settings/settings-placeholders';

export default function StagesSettingsPage() {
  return (
    <SettingsPage id="settings-stages" description="The steps a lead moves through, from new enquiry to won or lost.">
      <StagesSettings />
    </SettingsPage>
  );
}
