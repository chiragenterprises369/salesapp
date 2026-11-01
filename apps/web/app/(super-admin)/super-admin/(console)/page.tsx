import type { Metadata } from 'next';
import { PlatformOverview } from './_components/overview';

export const metadata: Metadata = { title: 'Overview' };

export default function SuperAdminOverviewPage() {
  return <PlatformOverview />;
}
