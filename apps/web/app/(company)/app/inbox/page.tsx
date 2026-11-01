import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/common/placeholder-page';

export const metadata: Metadata = { title: 'Inbox' };

export default function InboxPage() {
  return (
    <PlaceholderPage
      title="Inbox"
      description="WhatsApp conversations with your leads, shared by the team."
      icon="MessageCircle"
      anyOf={['messages.read']}
      emptyTitle="No conversations yet"
      emptyDescription="Chats appear here once WhatsApp Business is connected. Replies land with the rep who owns the lead."
      action={{ label: 'Connect WhatsApp', href: '/app/integrations', anyOf: ['integrations.manage'] }}
      fallback={{ label: 'Open leads', href: '/app/leads', anyOf: ['leads.read'] }}
    />
  );
}
