import type { Metadata } from 'next';
import { PlatformSection } from '../_components/platform-section';

export const metadata: Metadata = { title: 'Usage' };

export default function SuperAdminUsagePage() {
  return (
    <PlatformSection
      section="usage"
      title="Usage"
      description="Seats, leads, WhatsApp messages, workflow runs and storage per company against plan limits."
      icon="Gauge"
      searchLabel="Search companies"
      columns={[{ key: 'company', label: 'Company' }, { key: 'seats', label: 'Seats', align: 'right' }, { key: 'leads', label: 'Leads', align: 'right' }, { key: 'whatsapp', label: 'WhatsApp this month', align: 'right', hideBelow: 'sm' }, { key: 'runs', label: 'Workflow runs', align: 'right', hideBelow: 'md' }, { key: 'storage', label: 'Storage', align: 'right', hideBelow: 'lg' }]}
      emptyTitle="No usage recorded yet"
      emptyDescription="Metering data appears here once the platform API is connected (Phase 9)."
    />
  );
}
