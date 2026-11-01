import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/common/placeholder-page';

export const metadata: Metadata = { title: 'Billing and usage' };

export default function BillingPage() {
  return (
    <PlaceholderPage
      title="Billing and usage"
      description="Your plan, seats and monthly usage against plan limits."
      icon="CreditCard"
      anyOf={['billing.read', 'billing.manage']}
      emptyTitle="No invoices yet"
      emptyDescription="Invoices and usage appear here at the end of each billing month."
      action={{ label: 'Open workspace settings', href: '/app/settings', anyOf: ['settings.manage'] }}
    />
  );
}
