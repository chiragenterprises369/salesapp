'use client';

import { SettingsPage } from '@/components/settings/settings-layout';
import { ThemeDefaultsForm } from '@/components/settings/theme-defaults-form';

export default function ThemeDefaultSettingsPage() {
  return (
    <SettingsPage id="settings-theme" description="What people see before they choose their own theme, interface style and Leads view.">
      <ThemeDefaultsForm />
    </SettingsPage>
  );
}
