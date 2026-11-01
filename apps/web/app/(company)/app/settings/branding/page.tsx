'use client';

import { SettingsPage } from '@/components/settings/settings-layout';
import { BrandingSettings } from '@/components/settings/settings-placeholders';

export default function BrandingSettingsPage() {
  return (
    <SettingsPage id="settings-branding" description="Your logo and accent colour across Vistar.">
      <BrandingSettings />
    </SettingsPage>
  );
}
