import type { Metadata } from 'next';
import { PlatformSection } from '../_components/platform-section';

export const metadata: Metadata = { title: 'Support' };

export default function SuperAdminSupportPage() {
  return (
    <PlatformSection
      section="support"
      title="Support"
      description="Time-limited, read-only View as company sessions. A reason is required and both audit logs record it."
      icon="LifeBuoy"
      searchLabel="Search sessions"
      columns={[{ key: 'company', label: 'Company' }, { key: 'reason', label: 'Reason' }, { key: 'admin', label: 'Started by', hideBelow: 'sm' }, { key: 'mode', label: 'Access', hideBelow: 'md' }, { key: 'ends', label: 'Ends', align: 'right' }]}
      emptyTitle="No support sessions"
      emptyDescription="Sessions you start appear here with their reason and expiry. Starting one needs the company to allow support access (Phase 9)."
    />
  );
}
