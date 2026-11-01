import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/common/placeholder-page';

export const metadata: Metadata = { title: 'Reports' };

export default function ReportsPage() {
  return (
    <PlaceholderPage
      title="Reports"
      description="Pipeline, source, call and team performance for any date range."
      icon="BarChart3"
      anyOf={['reports.read']}
      emptyTitle="Reports need a little history"
      emptyDescription="Once leads and calls come in, reports show conversion by stage, revenue by source and calls per rep."
      action={{ label: 'Open dashboard', href: '/app', anyOf: ['dashboard.read'] }}
    />
  );
}
