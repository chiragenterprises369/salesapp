import type { Metadata } from 'next';
import { InboxView } from '@/components/employee/inbox-view';

export const metadata: Metadata = { title: 'Inbox' };

export default function MyInboxPage() {
  return <InboxView />;
}
