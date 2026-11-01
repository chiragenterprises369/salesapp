'use client';

import { ObjectsSettings } from '@/components/settings/objects/objects-settings';
import { SettingsPage } from '@/components/settings/settings-layout';

export default function ObjectsSettingsPage() {
  return (
    <SettingsPage id="settings-objects" description="Record types of your own, such as Suppliers or Projects, each with fields, a records page and an optional menu item.">
      <ObjectsSettings />
    </SettingsPage>
  );
}
