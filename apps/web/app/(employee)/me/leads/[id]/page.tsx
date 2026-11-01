import type { Metadata } from 'next';
import { LeadDetailPage } from '@/components/lead-detail/lead-detail-page';

export const metadata: Metadata = { title: 'Lead' };

export default async function EmployeeLeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeadDetailPage leadId={id} panel="employee" />;
}
