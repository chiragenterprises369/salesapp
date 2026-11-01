import type { Metadata } from 'next';
import { InviteForm } from '@/components/auth/invite-form';

export const metadata: Metadata = { title: 'Accept invite', robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteForm token={decodeURIComponent(token)} />;
}
