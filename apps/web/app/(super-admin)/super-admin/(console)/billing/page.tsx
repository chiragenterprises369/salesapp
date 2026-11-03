import type { Metadata } from 'next';
import { SubscriptionsPage } from '@/components/billing/super/subscriptions-page';

export const metadata: Metadata = { title: 'Billing' };

export default function SuperAdminBillingPage() {
  return <SubscriptionsPage />;
}