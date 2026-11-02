'use client';

import { CustomDomainSettings } from '@/components/settings/custom-domain-settings';
import { SettingsPage } from '@/components/settings/settings-layout';

export default function DomainSettingsPage() {
  return (
    <SettingsPage id="settings-domain" description="Open Vistar on your own address, for example crm.yourcompany.com, with your branding on the sign-in page.">
      <CustomDomainSettings />
    </SettingsPage>
  );
}
