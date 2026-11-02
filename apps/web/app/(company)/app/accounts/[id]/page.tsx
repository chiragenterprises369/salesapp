import type { Metadata } from 'next';
import { AccountDetailPage } from '@/components/accounts/account-detail';

export const metadata: Metadata = { title: 'Account' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AccountDetailPage id={id} />;
}
