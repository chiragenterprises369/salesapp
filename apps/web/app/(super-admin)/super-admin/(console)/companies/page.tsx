import type { Metadata } from 'next';
import { PlatformSection } from '../_components/platform-section';

export const metadata: Metadata = { title: 'Companies' };

export default function SuperAdminCompaniesPage() {
  return (
    <PlatformSection
      section="companies"
      title="Companies"
      description="Every workspace on Vistar with plan, status and usage."
      icon="Building2"
      searchLabel="Search companies"
      columns={[{ key: 'company', label: 'Company' }, { key: 'plan', label: 'Plan' }, { key: 'status', label: 'Status' }, { key: 'seats', label: 'Seats', align: 'right', hideBelow: 'sm' }, { key: 'leads', label: 'Leads', align: 'right', hideBelow: 'md' }, { key: 'created', label: 'Created', hideBelow: 'lg' }]}
      emptyTitle="No companies loaded"
      emptyDescription="The company directory arrives with the platform API (Phase 9)."
    />
  );
}
