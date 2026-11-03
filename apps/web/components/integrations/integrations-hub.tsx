'use client';

import { NAV_COMPANY } from '@vistar/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Plug, RefreshCw, Settings2, Unplug } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
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
import { INTEGRATION_STATUS, inFuture, statusOf } from '@/lib/hub/format';
import { useIntegrationCatalog, useIntegrationMutations, useIntegrations } from '@/lib/hub/integrations';
import { useHubRealtime } from '@/lib/hub/realtime';
import { hubKeys } from '@/lib/hub/keys';
import { useCan } from '@/lib/session/session';
import { ConnectSheet } from './connect-sheet';
import { CATEGORY_LABEL, ProviderIcon } from './providers';
import { integrationViews, type IntegrationView } from './view';

const NAV_ITEM = NAV_COMPANY.flatMap((g) => g.items).find((i) => i.id === 'integrations');

/** Labels of the per-provider numbers the API reports on the card (unknown keys are skipped). */
const STAT_LABEL: Record<string, string> = {
  leadsImported30d: 'Leads in 30 days',
  lastPulledCount: 'Last pull',
  messagesReceived30d: 'Messages in 30 days',
  messagesSent30d: 'Sent in 30 days',
  calls30d: 'Calls in 30 days',
  emailsSent30d: 'Emails in 30 days',
  account: 'Account',
  meetingsSynced30d: 'Meetings copied',
};

/** Company > Integrations: one card per provider with status, last sync, last error and the actions. */
export function IntegrationsHub() {
  return (
    <RequirePermission anyOf={NAV_ITEM?.anyOf ?? ['integrations.manage']}>
      <OAuthResult />
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

/**
 * Back from Google sign-in: the API redirects to /app/integrations?provider=google_calendar&result=connected|error.
 * Say what happened once, then drop the query so a reload does not repeat it.
 */
function OAuthResult() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const result = params.get('result');
  const message = params.get('message');
  useEffect(() => {
    if (!result) return;
    if (result === 'connected') toast.success('Google Calendar connected');
    else toast.error(message || 'Google sign-in did not finish. Try Connect with Google again.');
    void qc.invalidateQueries({ queryKey: hubKeys.integrations.all });
    router.replace(pathname, { scroll: false });
  }, [result, message, router, pathname, qc]);
  return null;
}

function HubBody() {
  useHubRealtime();
  const list = useIntegrations();
  const catalog = useIntegrationCatalog();
  const [openProvider, setOpenProvider] = useState<string | null>(null);
  if (isMockData())
    return (
      <InlineAlert tone="info" title="Integrations need the Vistar API">
        This build runs on sample data for automated tests. Connect integrations on a build that uses the API.
      </InlineAlert>
    );
  if (list.isPending || catalog.isPending)
    return (
      <div role="status" aria-label="Loading integrations" className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-52 w-full rounded-lg" />
        ))}
      </div>
    );
  if (list.isError || catalog.isError)
    return (
      <LoadError
        title="Integrations did not load"
        onRetry={() => {
          void list.refetch();
          void catalog.refetch();
        }}
      />
    );
  const views = integrationViews(list.data.items, catalog.data.items);
  const connected = views.filter((v) => v.row.status === 'connected').length;
  const open = views.find((v) => v.provider === openProvider) ?? null;
  return (
    <>
      <p className="mb-3 text-sm text-fg-secondary" aria-live="polite">
        {connected === 0 ? 'Nothing connected yet. Start with IndiaMART: add your Pull API key and new enquiries become leads within minutes.' : `${connected} of ${views.length} connected.`}
      </p>
      <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label="Integrations">
        {views.map((v) => (
          <ProviderCard key={v.provider} view={v} onOpen={() => setOpenProvider(v.provider)} />
        ))}
      </ul>
      {open && <ConnectSheet key={open.provider} view={open} onClose={() => setOpenProvider(null)} />}
    </>
  );
}

function ProviderCard({ view: v, onOpen }: { view: IntegrationView; onOpen: () => void }) {
  const now = useNow(30_000);
  const canManage = useCan('integrations.manage');
  const { reason } = useReadOnly();
  const m = useIntegrationMutations();
  const [confirm, setConfirm] = useState(false);
  const row = v.row;
  const status = statusOf(INTEGRATION_STATUS, row.status);
  const titleId = `integration-${v.provider}`;
  const caps = v.info?.capabilities;
  const fail = (e: unknown) => toast.error(formErrorMessage(e, 'That did not work. Try again.'));
  const stats = Object.entries(row.stats ?? {}).filter(([k, val]) => STAT_LABEL[k] && val !== null && val !== '');
  const testing = m.test.isPending && m.test.variables?.provider === v.provider;
  const syncing = m.sync.isPending && m.sync.variables === v.provider;

  const test = () =>
    m.test.mutate(
      { provider: v.provider },
      { onSuccess: (r) => (r.ok ? toast.success(`${v.name}: ${r.message}`) : toast.error(`${v.name}: ${r.message}`)), onError: fail },
    );
  const sync = () =>
    m.sync.mutate(v.provider, {
      onSuccess: (r) =>
        r.ok
          ? toast.success(`${v.name} synced`, { description: `${r.fetched} fetched, ${r.created} new, ${r.updated} updated, ${r.skipped} already in Vistar.` })
          : toast.error(`${v.name}: ${r.message}`),
      onError: fail,
    });

  return (
    <li>
      <Card className="flex h-full flex-col" data-provider={v.provider} data-status={row.status}>
        <section aria-labelledby={titleId} className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex items-start gap-3">
            <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-3 text-fg-secondary">
              <ProviderIcon provider={v.provider} className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 id={titleId} className="text-sm font-semibold text-fg">
                  {v.name}
                </h2>
                <Chip tone={status.tone} dot data-testid="integration-status">
                  {status.label}
                </Chip>
                {row.mode === 'mock' && row.status !== 'not_connected' && <Chip tone="indigo">Test mode</Chip>}
              </div>
              <p className="mt-0.5 text-xs text-muted-strong">{CATEGORY_LABEL[v.info?.category ?? ''] ?? 'Integration'}</p>
            </div>
          </div>
          <p className="text-sm text-fg-secondary">{v.info?.description}</p>
          {v.blockedReason && row.status === 'not_connected' && <p className="text-xs text-muted-strong">{v.blockedReason}</p>}
          <dl className="mt-auto grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {v.configured && caps?.sync && (
              <>
                <dt className="text-muted-strong">Last sync</dt>
                <dd className="text-fg-secondary">
                  {row.lastSyncAt ? ago(row.lastSyncAt, now) : 'Not yet'}
                  {row.nextSyncAt && now ? `, next ${inFuture(row.nextSyncAt, now)}` : ''}
                </dd>
              </>
            )}
            {v.configured && (
              <>
                <dt className="text-muted-strong">Last checked</dt>
                <dd className="text-fg-secondary">{row.lastCheckedAt ? ago(row.lastCheckedAt, now) : 'Not yet'}</dd>
              </>
            )}
            {stats.map(([k, val]) => (
              <div key={k} className="contents">
                <dt className="text-muted-strong">{STAT_LABEL[k]}</dt>
                <dd className="tabular text-fg-secondary">{typeof val === 'number' ? val.toLocaleString('en-IN') : val}</dd>
              </div>
            ))}
          </dl>
          {row.status === 'needs_attention' && row.attention && (
            <InlineAlert tone="warning" className="text-xs">
              {row.attention}
            </InlineAlert>
          )}
          {row.status === 'error' && row.lastError && <InlineAlert className="text-xs">{row.lastError}</InlineAlert>}
        </section>
        {canManage && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-3">
            <Button size="sm" onClick={onOpen} aria-label={v.configured ? `Settings of ${v.name}` : `Connect ${v.name}`}>
              {v.configured ? <Settings2 aria-hidden /> : <Plug aria-hidden />}
              {v.configured ? 'Settings' : 'Connect'}
            </Button>
            {v.configured && caps?.test && (
              <Button size="sm" variant="ghost" onClick={test} loading={testing} disabled={!!reason}>
                Test
              </Button>
            )}
            {v.configured && caps?.sync && (
              <Button size="sm" variant="ghost" onClick={sync} loading={syncing} disabled={!!reason}>
                <RefreshCw aria-hidden />
                Sync now
              </Button>
            )}
            {v.configured && (
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setConfirm(true)} disabled={!!reason} aria-label={`Disconnect ${v.name}`}>
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
        title={`Disconnect ${v.name}?`}
        description="Vistar stops using it and deletes the stored keys and tokens. Leads, messages and calls already in Vistar stay. You can connect again at any time."
        confirmLabel="Disconnect"
        loading={m.disconnect.isPending}
        onConfirm={() =>
          m.disconnect.mutate(v.provider, {
            onSuccess: () => {
              toast.success(`${v.name} disconnected`);
              setConfirm(false);
            },
            onError: fail,
          })
        }
      />
    </li>
  );
}
