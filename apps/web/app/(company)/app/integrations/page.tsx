import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/common/placeholder-page';

export const metadata: Metadata = { title: 'Integrations' };

export default function IntegrationsPage() {
  return (
    <PlaceholderPage
      title="Integrations"
      description="Bring leads in from IndiaMART, your website and WhatsApp, and connect your phone system."
      icon="Plug"
      anyOf={['integrations.manage']}
      emptyTitle="Nothing connected yet"
      emptyDescription="Start with IndiaMART: add your CRM key and new enquiries become leads within a minute."
      action={{ label: 'Set up lead routing', href: '/app/settings/routing', anyOf: ['settings.manage'] }}
    />
  );
}
