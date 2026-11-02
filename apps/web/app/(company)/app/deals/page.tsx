import type { Metadata } from 'next';
import { DealsPage } from '@/components/deals/deals-page';

export const metadata: Metadata = { title: 'Deals' };

export default function Page() {
  return <DealsPage />;
}
