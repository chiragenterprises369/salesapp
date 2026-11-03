import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BillingPage } from '@/components/billing/billing-page';

export const metadata: Metadata = { title: 'Billing and usage' };

export default function Page() {
  return (
    <Suspense>
      <BillingPage />
    </Suspense>
  );
}