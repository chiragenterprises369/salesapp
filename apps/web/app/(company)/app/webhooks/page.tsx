import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/common/placeholder-page';

export const metadata: Metadata = { title: 'Webhooks and logs' };

export default function WebhooksPage() {
  return (
    <PlaceholderPage
      title="Webhooks and logs"
      description="Send lead, call and stage events to your own systems and check every delivery."
      icon="Webhook"
      anyOf={['webhooks.manage']}
      emptyTitle="No webhook endpoints"
      emptyDescription="Add an endpoint URL to receive signed events. Every delivery attempt and response is logged here."
      action={{ label: 'Browse integrations', href: '/app/integrations', anyOf: ['integrations.manage'] }}
    />
  );
}
