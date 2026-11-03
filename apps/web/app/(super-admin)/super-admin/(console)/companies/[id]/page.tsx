import type { Metadata } from 'next';
import { CompanyDetail } from './_components/company-detail';
import { isCompanyTab } from './_components/tabs';

export const metadata: Metadata = { title: 'Company' };

export default async function SuperAdminCompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string | string[] }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  const first = Array.isArray(tab) ? tab[0] : tab;
  return <CompanyDetail companyId={decodeURIComponent(id)} initialTab={isCompanyTab(first) ? first : 'overview'} />;
}
