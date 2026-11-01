import type { Metadata } from 'next';
import { PlatformSection } from '../_components/platform-section';

export const metadata: Metadata = { title: 'Feature flags' };

export default function SuperAdminFlagsPage() {
  return (
    <PlatformSection
      section="flags"
      title="Feature flags"
      description="Plan defaults and per-company overrides for features such as the 3D floor and the AI node."
      icon="ToggleRight"
      searchLabel="Search companies"
      columns={[{ key: 'company', label: 'Company' }, { key: 'flag', label: 'Flag' }, { key: 'value', label: 'Value' }, { key: 'reason', label: 'Reason', hideBelow: 'md' }, { key: 'updated', label: 'Updated', hideBelow: 'sm' }]}
      emptyTitle="No overrides loaded"
      emptyDescription="Plan defaults and company overrides arrive with the platform API (Phase 9)."
    />
  );
}
