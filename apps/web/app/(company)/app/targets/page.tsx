import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/common/placeholder-page';

export const metadata: Metadata = { title: 'Targets' };

export default function TargetsPage() {
  return (
    <PlaceholderPage
      title="Targets"
      description="Monthly revenue, deals, calls and conversion targets for each person and team."
      icon="Target"
      anyOf={['targets.read']}
      emptyTitle="No targets for this month"
      emptyDescription="Set a target per person or team. Progress shows here and on each rep's My performance page."
      action={{ label: 'Open reports', href: '/app/reports', anyOf: ['reports.read'] }}
    />
  );
}
