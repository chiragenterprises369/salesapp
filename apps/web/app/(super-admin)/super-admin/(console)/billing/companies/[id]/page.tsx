import type { Metadata } from 'next';
import { CompanyBillingTab } from '@/components/billing/super/company-billing';

export const metadata: Metadata = { title: 'Company billing' };

export default async function SuperAdminCompanyBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompanyBillingTab companyId={decodeURIComponent(id)} />;
}