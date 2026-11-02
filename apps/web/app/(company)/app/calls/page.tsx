import type { Metadata } from 'next';
import { CallsPage } from '@/components/calls/calls-page';

export const metadata: Metadata = { title: 'Calls' };

export default function Page() {
  return <CallsPage />;
}
