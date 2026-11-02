'use client';

import { BrandingSettings } from '@/components/settings/branding/branding-settings';
import { SettingsPage } from '@/components/settings/settings-layout';

export default function BrandingSettingsPage() {
  return (
    <SettingsPage id="settings-branding" description="Your name, logo, colours and sign-in image across Vistar.">
      <BrandingSettings />
    </SettingsPage>
  );
}
