import type { Metadata } from 'next';
import { StatusControl } from '@/components/employee/status-control';

export const metadata: Metadata = { title: 'My status' };

export default function MyStatusPage() {
  return <StatusControl />;
}
