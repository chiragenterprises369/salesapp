import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WebhooksPage } from '@/components/webhooks/webhooks-page';

export const metadata: Metadata = { title: 'Webhooks and logs' };

export default function Page() {
  return (
    <Suspense>
      <WebhooksPage />
    </Suspense>
  );
}
