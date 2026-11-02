'use client';

import { CaptureFormsList } from '@/components/capture/capture-forms-list';
import { SettingsPage } from '@/components/settings/settings-layout';

export default function LeadCapturePage() {
  return (
    <SettingsPage id="settings-lead-capture" description="Forms for your website or a hosted page. Each submission becomes a lead and is routed to the right person.">
      <CaptureFormsList />
    </SettingsPage>
  );
}
