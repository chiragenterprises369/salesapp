import type { Metadata } from 'next';
import { Suspense } from 'react';
import { IntegrationsHub } from '@/components/integrations/integrations-hub';

export const metadata: Metadata = { title: 'Integrations' };

export default function IntegrationsPage() {
  return (
    <Suspense>
      <IntegrationsHub />
    </Suspense>
  );
}
