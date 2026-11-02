import type { Metadata } from 'next';
import { CompaniesSection } from '../_components/company-switches';

export const metadata: Metadata = { title: 'Companies' };

export default function SuperAdminCompaniesPage() {
  return <CompaniesSection />;
}
