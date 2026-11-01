'use client';

import { SettingsPage } from '@/components/settings/settings-layout';
import { RoutingSettings } from '@/components/settings/settings-placeholders';

export default function RoutingSettingsPage() {
  return (
    <SettingsPage id="settings-routing" description="Who gets each new lead, and when.">
      <RoutingSettings />
    </SettingsPage>
  );
}
