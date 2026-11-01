'use client';

import { MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';

/**
 * Employee inbox placeholder. Conversations (GET /conversations?assigneeId=me) and the composer arrive
 * with the WhatsApp integration (Wave 2); until then it explains where chats will appear.
 */
export function InboxView() {
  return (
    <RequirePermission anyOf={['messages.read']}>
      <PageHeader title="Inbox" description="WhatsApp chats with your leads." />
      <EmptyState
        icon={<MessageCircle />}
        title="No chats yet"
        description="When one of your leads messages the company on WhatsApp, the chat shows up here and on the lead."
        action={
          <Button asChild variant="primary" size="touch">
            <Link href="/me/leads">Open my leads</Link>
          </Button>
        }
      />
    </RequirePermission>
  );
}
