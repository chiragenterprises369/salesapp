import type { Metadata } from 'next';
import { AccountsPage } from '@/components/accounts/accounts-page';

export const metadata: Metadata = { title: 'Accounts' };

export default function Page() {
  return <AccountsPage />;
}
