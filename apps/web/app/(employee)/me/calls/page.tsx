import type { Metadata } from 'next';
import { CallsView } from '@/components/employee/calls-view';

export const metadata: Metadata = { title: 'Calls' };

export default function MyCallsPage() {
  return <CallsView />;
}
