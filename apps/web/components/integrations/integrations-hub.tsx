'use client';

import { NAV_COMPANY } from '@vistar/shared';
import { CalendarDays, Mail, MessageCircle, PhoneCall, Plug, RefreshCw, Settings2, Store, Unplug, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/common/page-header';
import { useNow } from '@/components/common/use-now';
import { InlineAlert, LoadError } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { isMockData } from '@/lib/api/data-source';
import { useReadOnly } from '@/lib/auth/use-auth';
import { ago } from '@/lib/crm/format';
import { ConfirmDialog } from '@/lib/crm/ui/confirm-dialog';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { INTEGRATION_STATUS, statusOf } from '@/lib/hub/format';
import { useIntegrationMutations, useIntegrations } from '@/lib/hub/integrations';
import { useHubRealtime } from '@/lib/hub/realtime';
import { useCan, useMe } from '@/lib/session/session';
import { ConnectSheet } from './connect-sheet';
import { integrationViews, type IntegrationView } from './view';

const ICONS: Record<string, LucideIcon> = { Store, MessageCircle, PhoneCall, Mail, CalendarDays, Plug };

const NAV_ITEM = NAV_COMPANY.flatMap((g) => g.items).find((i) => i.id === 'integrations');

/** Company > Integrations: one card per provider with its status, last sync and last error; connect, test, sync and disconnect. */
export function IntegrationsHub() {
  return (
    <RequirePermission anyOf={NAV_ITEM?.anyOf ?? ['integrations.manage']}>
      <PageHeader
        title="Integrations"
        description="Bring leads in from IndiaMART, talk to customers on WhatsApp, call from Vistar and send email from your own address."
        actions={
          <Button asChild>
            <Link href="/app/webhooks">Webhooks and logs</Link>
          </Button>
        }
      />
      <HubBody />
    </RequirePermission>
  );
}

function HubBody() {
  useHubRealtime();
  const me = useMe()!;
  const q = useIntegrations();
  const [open, setOpen] = useState<IntegrationView | null>(null);
  if (isMockData())
    return (
      <InlineAlert tone="info" title="Integrations need the Vistar API">
        This build runs on sample data for automated tests. Connect integrations on a build that uses the API.
      </InlineAlert>
    );
  if (q.isPending)
    return (
      <div role="status" aria-label="Loading integrations" className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-44 w-full rounded-lg" />
        ))}
      </div>
    );
  if (q.isError) return <LoadError title="Integrations did not load" onRetry={() => void q.refetch()} />;
  const views = integrationViews(q.data.items, me.workspace.id);
  const connected = views.filter((v) => v.connected).length;
  return (
    <>
      <p className="mb-3 text-sm text-fg-secondary" aria-live="polite">
        {connected === 0 ? 'Nothing connected yet. Start with IndiaMART: add your CRM key and new enquiries become leads within minutes.' : `${connected} of ${views.length} connected.`}
      </p>
      <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label="Integrations">
        {views.map((v) => (
          <ProviderCard key={v.provider} view={v} onOpen={() => setOpen(v)} />
        ))}
      </ul>
      {open && <ConnectSheet key={open.provider} view={views.find((v) => v.provider === open.provider) ?? open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ProviderCard({ view: v, onOpen }: { view: IntegrationView; onOpen: () => void }) {
  const now = useNow(30_000);
  const canManage = useCan('integrations.manage');
  const { reason } = useReadOnly();
  const m = useIntegrationMutations();
  const [confirm, setConfirm] = useState(false);
  const status = statusOf(INTEGRATION_STATUS, v.status);
  const Icon = ICONS[v.meta.icon] ?? Plug;
  const titleId = `integration-${v.provider}`;
  const fail = (e: unknown) => toast.error(formErrorMessage(e, 'That did not work. Try again.'));

  const test = () =>
    m.test.mutate(v.provider, {
      onSuccess: (r) => (r.ok ? toast.success(`${v.meta.name}: ${r.message}`) : toast.error(`${v.meta.name}: ${r.message}`)),
      onError: fail,
    });
  const sync = () =>
    // "Sync now" runs the same check as the test plus a fetch when the API supports it (requests-19c W2).
    m.test.mutate(v.provider, { onSuccess: (r) => (r.ok ? toast.success(`${v.meta.name} is syncing`) : toast.error(r.message)), onError: fail });

  return (
    <li>
      <Card className="flex h-full flex-col" data-provider={v.provider} data-status={v.status}>
        <section aria-labelledby={titleId} className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex items-start gap-3">
            <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-3 text-fg-secondary">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={titleId} className="text-sm font-semibold text-fg">
                  {v.meta.name}
                </h2>
                <Chip tone={status.tone} dot data-testid="integration-status">
                  {status.label}
                </Chip>
              </div>
              <p className="mt-0.5 text-xs text-muted-strong">{v.meta.category}</p>
            </div>
          </div>
          <p className="text-sm text-fg-secondary">{v.meta.description}</p>
          <dl className="mt-auto grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {v.configured && v.meta.canSync && (
              <>
                <dt className="text-muted-strong">Last sync</dt>
                <dd className="text-fg-secondary">{v.lastSyncAt ? ago(v.lastSyncAt, now) : 'Not yet'}</dd>
              </>
            )}
            {v.configured && (
              <>
                <dt className="text-muted-strong">Last checked</dt>
                <dd className="text-fg-secondary">{v.lastCheckedAt ? ago(v.lastCheckedAt, now) : 'Not yet'}</dd>
              </>
            )}
            {v.connectedAt && (
              <>
                <dt className="text-muted-strong">Connected</dt>
                <dd className="text-fg-secondary">{ago(v.connectedAt, now)}</dd>
              </>
            )}
          </dl>
          {v.lastError && v.status !== 'connected' && (
            <InlineAlert tone={v.status === 'needs_attention' ? 'warning' : 'danger'} className="text-xs">
              {v.lastError}
            </InlineAlert>
          )}
        </section>
        {canManage && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-3">
            <Button size="sm" onClick={onOpen} disabled={!!reason && !v.configured} aria-label={v.configured ? `Settings of ${v.meta.name}` : `Connect ${v.meta.name}`}>
              {v.configured ? <Settings2 aria-hidden /> : <Plug aria-hidden />}
              {v.configured ? 'Settings' : 'Connect'}
            </Button>
            {v.configured && v.meta.canTest && (
              <Button size="sm" variant="ghost" onClick={test} loading={m.test.isPending && m.test.variables === v.provider} disabled={!!reason}>
                Test
              </Button>
            )}
            {v.configured && v.meta.canSync && (
              <Button size="sm" variant="ghost" onClick={sync} disabled={!!reason || m.test.isPending}>
                <RefreshCw aria-hidden />
                Sync now
              </Button>
            )}
            {v.configured && (
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setConfirm(true)} disabled={!!reason} aria-label={`Disconnect ${v.meta.name}`}>
                <Unplug aria-hidden />
                Disconnect
              </Button>
            )}
          </div>
        )}
      </Card>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Disconnect ${v.meta.name}?`}
        description="Vistar stops using it and deletes the stored keys and tokens. Leads, messages and calls already in Vistar stay. You can connect again at any time."
        confirmLabel="Disconnect"
        loading={m.disconnect.isPending}
        onConfirm={() =>
          m.disconnect.mutate(v.provider, {
            onSuccess: () => {
              toast.success(`${v.meta.name} disconnected`);
              setConfirm(false);
            },
            onError: fail,
          })
        }
      />
    </li>
  );
}
