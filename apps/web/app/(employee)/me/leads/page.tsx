import type { Metadata } from 'next';
import { LeadsPage } from '@/components/leads/leads-page';

export const metadata: Metadata = { title: 'My leads' };

export default function EmployeeLeadsPage() {
  return <LeadsPage panel="employee" />;
}
