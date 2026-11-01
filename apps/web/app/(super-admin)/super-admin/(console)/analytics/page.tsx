import type { Metadata } from 'next';
import { PlatformSection } from '../_components/platform-section';

export const metadata: Metadata = { title: 'Analytics' };

export default function SuperAdminAnalyticsPage() {
  return (
    <PlatformSection
      section="analytics"
      title="Analytics"
      description="Sign-ups, activation, retention and revenue trends across all companies."
      icon="LineChart"
      columns={[{ key: 'metric', label: 'Metric' }, { key: 'current', label: 'This month', align: 'right' }, { key: 'previous', label: 'Last month', align: 'right' }, { key: 'change', label: 'Change', align: 'right', hideBelow: 'sm' }]}
      emptyTitle="No analytics yet"
      emptyDescription="Trends appear here once the platform API is connected (Phase 9)."
    />
  );
}
