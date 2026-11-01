import type { Metadata } from 'next';
import { PlatformSection } from '../_components/platform-section';

export const metadata: Metadata = { title: 'Platform health' };

export default function SuperAdminHealthPage() {
  return (
    <PlatformSection
      section="health"
      title="Platform health"
      description="Status of the API, workers, database, queues and third-party providers."
      icon="Activity"
      columns={[{ key: 'service', label: 'Service' }, { key: 'status', label: 'Status' }, { key: 'p95', label: 'p95 latency', align: 'right' }, { key: 'errors', label: 'Error rate', align: 'right', hideBelow: 'sm' }, { key: 'checked', label: 'Last check', hideBelow: 'md' }]}
      emptyTitle="No health checks yet"
      emptyDescription="Service checks report here once monitoring is connected (Phase 9)."
    />
  );
}
