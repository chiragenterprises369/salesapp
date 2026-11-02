'use client';

import { BillingProfileSettings } from '@/components/invoices/billing-profile-form';
import { SettingsPage } from '@/components/settings/settings-layout';

export default function BillingProfilePage() {
  return (
    <SettingsPage id="settings-billing-profile" description="Your GSTIN, business address and state, bank details, numbering and terms for quotations and invoices.">
      <BillingProfileSettings />
    </SettingsPage>
  );
}
