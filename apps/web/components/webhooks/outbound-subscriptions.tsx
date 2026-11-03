'use client';

import { OUTBOUND_EVENT_INFO, type OutboundWebhookEvent, type WebhookEndpoint } from '@vistar/shared';
import { ArrowUpFromLine, Code2, History, KeyRound, Pencil, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { Switch } from '@/components/common/switch';
import { useNow } from '@/components/common/use-now';
import { InlineAlert, ListSkeleton, LoadError } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { ago, formatDateTimeIn } from '@/lib/crm/format';
import { ConfirmDialog } from '@/lib/crm/ui/confirm-dialog';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { DELIVERY_STATUS, statusOf } from '@/lib/hub/format';
import { useWebhookEndpoints, useWebhookMutations } from '@/lib/hub/webhooks';
import { SecretOnceDialog, type ShownOnceSecret } from '@/lib/hub/ui/secret-once';
import { useCan, useMe } from '@/lib/session/session';
import { OutboundSheet } from './outbound-sheet';
import { RotateSecretDialog } from './rotate-secret';
import { OutboundSignatureHelp } from './signature-help';

type EndpointsQuery = ReturnType<typeof useWebhookEndpoints>;

/** Outbound tab: subscriptions with URL, events, health (auto-disable, failures) and actions incl. test send. */
export function OutboundSubscriptions({
  query,
  creating,
  onCreated,
  onCancelCreate,
  onShowLog,
  onOpenDelivery,
}: {
  query: EndpointsQuery;
  creating: boolean;
  onCreated: () => void;
  onCancelCreate: () => void;
  onShowLog: (endpointId: string) => void;
  onOpenDelivery: (deliveryId: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [secret, setSecret] = useState<ShownOnceSecret | null>(null);
  const [rotating, setRotating] = useState<WebhookEndpoint | null>(null);
  const [deleting, setDeleting] = useState<WebhookEndpoint | null>(null);
  const m = useWebhookMutations();
  const subs = (query.data?.items ?? []).filter((e) => e.direction === 'outbound');
  const editingSub = subs.find((s) => s.id === editing) ?? null;

  let body;
  if (query.isPending) body = <ListSkeleton rows={2} label="Loading subscriptions" />;
  else if (query.isError) body = <LoadError title="Subscriptions did not load" onRetry={() => void query.refetch()} />;
  else if (subs.length === 0)
    body = (
      <EmptyState
        icon={<ArrowUpFromLine />}
        title="No subscriptions yet"
        description="Send new leads, stage changes, calls and more to your ERP, Google Sheets through a connector, or your own server. Every delivery is signed, retried and logged."
      />
    );
  else
    body = (
      <ul className="grid gap-4 xl:grid-cols-2" aria-label="Outbound subscriptions">
        {subs.map((s) => (
          <SubscriptionCard key={s.id} sub={s} onEdit={() => setEditing(s.id)} onRotate={() => setRotating(s)} onDelete={() => setDeleting(s)} onShowLog={() => onShowLog(s.id)} onOpenDelivery={onOpenDelivery} />
        ))}
      </ul>
    );

  return (
    <>
      {body}
      {(creating || editingSub) && (
        <OutboundSheet
          key={editingSub?.id ?? 'new'}
          endpoint={editingSub ?? undefined}
          onClose={() => {
            setEditing(null);
            onCancelCreate();
          }}
          onCreated={(_created, value) => {
            onCreated();
            setSecret({
              title: 'Subscription created',
              label: 'Signing secret',
              value,
              note: 'Your receiver uses it to check the X-Vistar-Signature header of every delivery. Send a test delivery next.',
              extra: <OutboundSignatureHelp />,
            });
          }}
        />
      )}
      <RotateSecretDialog endpoint={rotating} onClose={() => setRotating(null)} onSecret={setSecret} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'this subscription'}?`}
        description="Vistar stops sending events to it and drops retries that are still waiting. The delivery log keeps its past deliveries."
        confirmLabel="Delete subscription"
        loading={m.remove.isPending}
        onConfirm={() =>
          deleting &&
          m.remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(`${deleting.name} deleted`);
              setDeleting(null);
            },
            onError: (e) => toast.error(formErrorMessage(e)),
          })
        }
      />
      <SecretOnceDialog secret={secret} onClose={() => setSecret(null)} />
    </>
  );
}

function SubscriptionCard({ sub: s, onEdit, onRotate, onDelete, onShowLog, onOpenDelivery }: { sub: WebhookEndpoint; onEdit: () => void; onRotate: () => void; onDelete: () => void; onShowLog: () => void; onOpenDelivery: (id: string) => void }) {
  const now = useNow(30_000);
  const me = useMe();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const canManage = useCan('webhooks.manage');
  const { reason } = useReadOnly();
  const m = useWebhookMutations();
  const [help, setHelp] = useState(false);
  const titleId = `sub-${s.id}`;
  const fail = (e: unknown) => toast.error(formErrorMessage(e));
  const testing = m.testSend.isPending && m.testSend.variables?.id === s.id;

  const test = () =>
    m.testSend.mutate(
      { id: s.id },
      {
        onSuccess: (d) => {
          const st = statusOf(DELIVERY_STATUS, d.status);
          const msg = d.status === 'success' ? `Test delivered: HTTP ${d.responseStatus}` : `Test ${st.label.toLowerCase()}${d.responseStatus ? `: HTTP ${d.responseStatus}` : d.error ? `: ${d.error}` : ''}`;
          (d.status === 'success' ? toast.success : toast.error)(msg, { action: { label: 'Open', onClick: () => onOpenDelivery(d.id) } });
        },
        onError: fail,
      },
    );

  return (
    <li>
      <Card className="flex h-full flex-col" data-subscription={s.id}>
        <section aria-labelledby={titleId} className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 id={titleId} className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-fg">
                {s.name}
                {s.disabledAt ? <Chip tone="red">Turned off by Vistar</Chip> : s.isActive ? <Chip tone="green">Active</Chip> : <Chip tone="grey">Paused</Chip>}
                {!s.disabledAt && s.consecutiveFailures > 0 && <Chip tone="amber">{s.consecutiveFailures} failed {s.consecutiveFailures === 1 ? 'attempt' : 'attempts'}</Chip>}
              </h2>
              <p className="mt-0.5 font-mono text-xs break-all text-muted-strong">{s.url}</p>
            </div>
            {canManage && (
              <Switch
                aria-label={s.isActive && !s.disabledAt ? `Pause ${s.name}` : `Turn on ${s.name}`}
                checked={s.isActive && !s.disabledAt}
                disabled={!!reason}
                onCheckedChange={(isActive) => m.update.mutate({ id: s.id, patch: { isActive } }, { onSuccess: () => toast.success(isActive ? `${s.name} is on` : `${s.name} is paused`), onError: fail })}
              />
            )}
          </div>

          {s.disabledAt && (
            <InlineAlert tone="danger" className="text-xs">
              {s.disabledReason ?? 'Deliveries kept failing after every retry.'} Turned off {formatDateTimeIn(s.disabledAt, tz)}. Fix the receiver, send a test, then switch it on.
            </InlineAlert>
          )}

          <ul className="flex flex-wrap gap-1" aria-label="Events">
            {s.events.slice(0, 8).map((e) => (
              <li key={e}>
                <Chip tone="neutral">{OUTBOUND_EVENT_INFO[e as OutboundWebhookEvent]?.label ?? e}</Chip>
              </li>
            ))}
            {s.events.length > 8 && (
              <li>
                <Chip tone="neutral">and {s.events.length - 8} more</Chip>
              </li>
            )}
          </ul>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-muted-strong">Last 24 hours</dt>
            <dd className="text-fg-secondary">
              {s.stats.deliveries24h} {s.stats.deliveries24h === 1 ? 'delivery' : 'deliveries'}
              {s.stats.failures24h > 0 && <span className="text-danger-text">, {s.stats.failures24h} failed</span>}
            </dd>
            <dt className="text-muted-strong">Last success</dt>
            <dd className="text-fg-secondary">{s.lastSuccessAt ? ago(s.lastSuccessAt, now) : 'None yet'}</dd>
            {s.lastFailureAt && (
              <>
                <dt className="text-muted-strong">Last failure</dt>
                <dd className="text-fg-secondary">{ago(s.lastFailureAt, now)}</dd>
              </>
            )}
            <dt className="text-muted-strong">Secret</dt>
            <dd className="font-mono text-fg-secondary">
              {s.secretPreview}
              {s.previousSecretExpiresAt && now > 0 && new Date(s.previousSecretExpiresAt).getTime() > now && <span className="font-sans text-muted-strong"> (old one also signs until {formatDateTimeIn(s.previousSecretExpiresAt, tz)})</span>}
            </dd>
          </dl>
          {help && (
            <div className="rounded-md border border-border p-3">
              <OutboundSignatureHelp />
            </div>
          )}
        </section>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-3">
          {canManage && (
            <>
              <Button size="sm" onClick={onEdit}>
                <Pencil aria-hidden />
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={test} loading={testing} disabled={!!reason}>
                <Send aria-hidden />
                Send test
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" aria-expanded={help} onClick={() => setHelp((h) => !h)}>
            <Code2 aria-hidden />
            How to verify
          </Button>
          <Button size="sm" variant="ghost" onClick={onShowLog}>
            <History aria-hidden />
            Log
          </Button>
          {canManage && (
            <>
              <Button size="sm" variant="ghost" onClick={onRotate} disabled={!!reason}>
                <KeyRound aria-hidden />
                Rotate secret
              </Button>
              <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label={`Delete ${s.name}`} onClick={onDelete} disabled={!!reason}>
                <Trash2 aria-hidden />
              </Button>
            </>
          )}
        </div>
      </Card>
    </li>
  );
}
