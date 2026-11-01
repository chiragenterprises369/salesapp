import type { Metadata } from 'next';
import { PlatformSection } from '../_components/platform-section';

export const metadata: Metadata = { title: 'Audit log' };

export default function SuperAdminAuditPage() {
  return (
    <PlatformSection
      section="audit"
      title="Audit log"
      description="Every Super Admin action: who, what, which company and why."
      icon="ScrollText"
      searchLabel="Search actions"
      columns={[{ key: 'time', label: 'Time' }, { key: 'admin', label: 'Admin' }, { key: 'action', label: 'Action' }, { key: 'company', label: 'Company', hideBelow: 'sm' }, { key: 'reason', label: 'Reason', hideBelow: 'md' }]}
      emptyTitle="No entries yet"
      emptyDescription="Platform actions appear here once the platform API is connected (Phase 9)."
    />
  );
}
