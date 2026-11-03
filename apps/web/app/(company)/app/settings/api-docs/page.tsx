'use client';

import { ApiReference } from '@/components/api-docs/api-reference';
import { SettingsPage } from '@/components/settings/settings-layout';

export default function ApiDocsPage() {
  return (
    <SettingsPage id="settings-api-docs" description="Reference of the public Vistar API: every endpoint an API key can call, with parameters, bodies and a curl example.">
      <ApiReference />
    </SettingsPage>
  );
}
