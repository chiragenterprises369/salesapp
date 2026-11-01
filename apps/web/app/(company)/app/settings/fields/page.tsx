'use client';

import { FieldsSettings } from '@/components/settings/fields/fields-settings';
import { SettingsPage } from '@/components/settings/settings-layout';

export default function FieldsSettingsPage() {
  return (
    <SettingsPage id="settings-fields" description="Extra details your team records on leads, contacts, deals and your custom objects.">
      <FieldsSettings />
    </SettingsPage>
  );
}
