import type { Metadata } from 'next';
import { PlatformSection } from '../_components/platform-section';

export const metadata: Metadata = { title: 'Plans and billing' };

export default function SuperAdminPlansPage() {
  return (
    <PlatformSection
      section="plans"
      title="Plans and billing"
      description="Plans, prices and limits, plus invoices and payment status per company."
      icon="CreditCard"
      columns={[{ key: 'plan', label: 'Plan' }, { key: 'price', label: 'Price per month', align: 'right' }, { key: 'companies', label: 'Companies', align: 'right' }, { key: 'seats', label: 'Seats included', align: 'right', hideBelow: 'sm' }, { key: 'status', label: 'Status', hideBelow: 'md' }]}
      emptyTitle="No plans loaded"
      emptyDescription="Plan definitions and billing records arrive with the platform API (Phase 9)."
    />
  );
}
