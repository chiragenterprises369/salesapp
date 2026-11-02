'use client';

import { SettingsPage } from '@/components/settings/settings-layout';
import { OfficeMarkersSettings } from '@/features/team-floor/markers/office-markers';

export default function OfficeMarkersSettingsPage() {
  return (
    <SettingsPage
      id="settings-office-markers"
      description="Beacons, Wi-Fi, QR codes and NFC tags that show who is in which room on the Live Team Floor."
    >
      <OfficeMarkersSettings />
    </SettingsPage>
  );
}
