'use client';

import { SettingsPage } from '@/components/settings/settings-layout';
import { FieldsSettings } from '@/components/settings/settings-placeholders';

export default function FieldsSettingsPage() {
  return (
    <SettingsPage id="settings-fields" description="Extra details your team records on every lead.">
      <FieldsSettings />
    </SettingsPage>
  );
}
