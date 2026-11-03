'use client';

import { ApiKeysSettings } from '@/components/api-keys/api-keys-settings';
import { SettingsPage } from '@/components/settings/settings-layout';

export default function ApiKeysPage() {
  return (
    <SettingsPage id="settings-api-keys" description="Keys for your website, ERP and scripts to use the Vistar API. Each key is shown once; rotate or revoke it here.">
      <ApiKeysSettings />
    </SettingsPage>
  );
}
