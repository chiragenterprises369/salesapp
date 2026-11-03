'use client';

import { NAV_COMPANY } from '@vistar/shared';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/common/page-header';
import { Tabs } from '@/components/reports/page-kit';
import { InlineAlert } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { isMockData } from '@/lib/api/data-source';
import { useReadOnly } from '@/lib/auth/use-auth';
import { useHubRealtime } from '@/lib/hub/realtime';
import { useWebhookEndpoints } from '@/lib/hub/webhooks';
import { useCan } from '@/lib/session/session';
import { DeliveryLog } from './delivery-log';
import { InboundSources } from './inbound-sources';
import { OutboundSubscriptions } from './outbound-subscriptions';

const NAV_ITEM = NAV_COMPANY.flatMap((g) => g.items).find((i) => i.id === 'webhooks');
type Tab = 'inbound' | 'outbound' | 'log';
const TABS: readonly Tab[] = ['inbound', 'outbound', 'log'];

/**
 * Company > Webhooks and logs: inbound sources (unique signed URL, payload mapping into leads),
 * outbound subscriptions (signed events to your systems with retries) and the delivery log of both.
 * Tab and an open delivery live in the URL (`?tab=log&delivery=<id>`), so links from toasts work.
 */
export function WebhooksPage() {
  return (
    <RequirePermission anyOf={NAV_ITEM?.anyOf ?? ['webhooks.manage']}>
      <WebhooksBody />
    </RequirePermission>
  );
}

function WebhooksBody() {
  useHubRealtime();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const canManage = useCan('webhooks.manage');
  const { reason } = useReadOnly();
  const raw = params.get('tab');
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : 'inbound';
  const deliveryId = params.get('delivery');
  const endpoints = useWebhookEndpoints();
  const items = endpoints.data?.items ?? [];
  const [creating, setCreating] = useState<'inbound' | 'outbound' | null>(null);

  const go = (next: { tab?: Tab; delivery?: string | null; endpoint?: string | null }) => {
    const sp = new URLSearchParams(params.toString());
    if (next.tab) sp.set('tab', next.tab);
    if (next.delivery !== undefined) {
      if (next.delivery) sp.set('delivery', next.delivery);
      else sp.delete('delivery');
    }
    if (next.endpoint !== undefined) {
      if (next.endpoint) sp.set('endpoint', next.endpoint);
      else sp.delete('endpoint');
    }
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  const create = tab === 'outbound' ? 'outbound' : 'inbound';
  const panelId = 'webhooks-panel';
  return (
    <>
      <PageHeader
        title="Webhooks and logs"
        description="Receive leads from any system on a signed URL, send Vistar events to your own systems, and check every delivery."
        actions={
          <>
            <Button asChild>
              <Link href="/app/integrations">Integrations</Link>
            </Button>
            {canManage && tab !== 'log' && (
              <Button variant="primary" onClick={() => setCreating(create)} disabled={!!reason}>
                <Plus aria-hidden />
                {create === 'inbound' ? 'New inbound source' : 'New subscription'}
              </Button>
            )}
          </>
        }
      />
      {isMockData() ? (
        <InlineAlert tone="info" title="Webhooks need the Vistar API">
          This build runs on sample data for automated tests. Set up webhooks on a build that uses the API.
        </InlineAlert>
      ) : (
        <>
          <Tabs
            label="Webhooks"
            value={tab}
            onChange={(t) => go({ tab: t, delivery: null })}
            panelId={panelId}
            className="mb-4"
            tabs={[
              { value: 'inbound', label: 'Inbound sources', count: endpoints.data ? items.filter((e) => e.direction === 'inbound').length : undefined },
              { value: 'outbound', label: 'Outbound subscriptions', count: endpoints.data ? items.filter((e) => e.direction === 'outbound').length : undefined },
              { value: 'log', label: 'Delivery log' },
            ]}
          />
          <div id={panelId} role="tabpanel" aria-labelledby={`${panelId}-tab-${tab}`}>
            {tab === 'inbound' && <InboundSources query={endpoints} creating={creating === 'inbound'} onCreated={() => setCreating(null)} onCancelCreate={() => setCreating(null)} onShowLog={(id) => go({ tab: 'log', endpoint: id, delivery: null })} />}
            {tab === 'outbound' && <OutboundSubscriptions query={endpoints} creating={creating === 'outbound'} onCreated={() => setCreating(null)} onCancelCreate={() => setCreating(null)} onShowLog={(id) => go({ tab: 'log', endpoint: id, delivery: null })} onOpenDelivery={(id) => go({ tab: 'log', delivery: id })} />}
            {tab === 'log' && <DeliveryLog endpoints={items} endpointId={params.get('endpoint')} onEndpointChange={(id) => go({ endpoint: id })} deliveryId={deliveryId} onOpenDelivery={(id) => go({ delivery: id })} />}
          </div>
        </>
      )}
    </>
  );
}
