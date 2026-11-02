'use client';

import { RoutingRulesSettings } from '@/components/routing/routing-rules';
import { SettingsPage } from '@/components/settings/settings-layout';

export default function LeadRoutingPage() {
  return (
    <SettingsPage id="settings-routing" description="Who gets each new lead without an owner: rules in order, round robin or least busy, working hours and availability.">
      <RoutingRulesSettings />
    </SettingsPage>
  );
}
