'use client';

import { ComponentDesignForm } from '@/components/settings/component-design';
import { SettingsPage } from '@/components/settings/settings-layout';

export default function ComponentDesignSettingsPage() {
  return (
    <SettingsPage id="settings-design" description="Standard or Premium components for the whole company. Only company admins can change it.">
      <ComponentDesignForm />
    </SettingsPage>
  );
}
