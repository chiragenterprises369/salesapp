import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/common/placeholder-page';

export const metadata: Metadata = { title: 'Calls' };

export default function CallsPage() {
  return (
    <PlaceholderPage
      title="Calls"
      description="Every call made or received through Vistar, with outcome and recording."
      icon="Phone"
      anyOf={['calls.read']}
      emptyTitle="No calls logged yet"
      emptyDescription="Calls made with click-to-call from a lead appear here with duration, outcome and recording."
      action={{ label: 'Open leads', href: '/app/leads', anyOf: ['leads.read'] }}
    />
  );
}
