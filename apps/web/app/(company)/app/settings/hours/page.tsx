'use client';

import { BusinessHoursForm } from '@/components/settings/business-hours-form';
import { SettingsPage } from '@/components/settings/settings-layout';

export default function BusinessHoursSettingsPage() {
  return (
    <SettingsPage id="settings-hours" description="When your team works. Automations wait for these hours and skip holidays.">
      <BusinessHoursForm />
    </SettingsPage>
  );
}
