'use client';

import type { WebhookEndpoint } from '@vistar/shared';
import { ArrowDownToLine, Code2, History, KeyRound, Pencil, Radio, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { Switch } from '@/components/common/switch';
import { useNow } from '@/components/common/use-now';
import { ListSkeleton, LoadError } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { ago, formatDateTimeIn } from '@/lib/crm/format';
import { ConfirmDialog } from '@/lib/crm/ui/confirm-dialog';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { useWebhookEndpoints, useWebhookMutations } from '@/lib/hub/webhooks';
import { CopyField } from '@/lib/hub/ui/copy';
import { SecretOnceDialog, type ShownOnceSecret } from '@/lib/hub/ui/secret-once';
import { useCan, useMe } from '@/lib/session/session';
import { InboundSourceSheet } from './inbound-source-sheet';
import { RotateSecretDialog } from './rotate-secret';
import { InboundSignatureHelp } from './signature-help';

export const INBOUND_ACTION_LABEL: Record<string, string> = {
  create_lead: 'Creates a lead (lead routing picks the owner)',
  update_lead: 'Updates the lead with the same phone or email',
  start_workflow: 'Starts a workflow',
};

type EndpointsQuery = ReturnType<typeof useWebhookEndpoints>;

/** Inbound tab: one card per source with its URL, verification, action, sample capture and actions. */
export function InboundSources({
  query,
  creating,
  onCreated,
  onCancelCreate,
  onShowLog,
}: {
  query: EndpointsQuery;
  creating: boolean;
  onCreated: () => void;
  onCancelCreate: () => void;
  onShowLog: (endpointId: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [secret, setSecret] = useState<ShownOnceSecret | null>(null);
  /** Source to open for mapping once the shown-once dialog is closed (never two modals at once). */
  const [afterSecret, setAfterSecret] = useState<string | null>(null);
  const [rotating, setRotating] = useState<WebhookEndpoint | null>(null);
  const [deleting, setDeleting] = useState<WebhookEndpoint | null>(null);
  const m = useWebhookMutations();
  const now = useNow(5_000);
  const sources = (query.data?.items ?? []).filter((e) => e.direction === 'inbound');
  const capturing = now > 0 && sources.some((s) => s.captureUntil && new Date(s.captureUntil).getTime() > now);
  // Poll while a sample capture is running so the captured request shows up without a reload.
  useWebhookEndpoints({ poll: capturing });
  const editingSource = sources.find((s) => s.id === editing) ?? null;

  let body;
  if (query.isPending) body = <ListSkeleton rows={2} label="Loading inbound sources" />;
  else if (query.isError) body = <LoadError title="Inbound sources did not load" onRetry={() => void query.refetch()} />;
  else if (sources.length === 0)
    body = (
      <EmptyState
        icon={<ArrowDownToLine />}
        title="No inbound sources yet"
        description="An inbound source is a private URL that turns JSON from your website, a form tool, Zapier or any system into leads. Create one, send a sample, and map its fields."
      />
    );
  else
    body = (
      <ul className="grid gap-4 xl:grid-cols-2" aria-label="Inbound sources">
        {sources.map((s) => (
          <SourceCard key={s.id} source={s} onEdit={() => setEditing(s.id)} onRotate={() => setRotating(s)} onDelete={() => setDeleting(s)} onShowLog={() => onShowLog(s.id)} />
        ))}
      </ul>
    );

  return (
    <>
      {body}
      {(creating || editingSource) && (
        <InboundSourceSheet
          key={editingSource?.id ?? 'new'}
          source={editingSource ?? undefined}
          onClose={() => {
            setEditing(null);
            onCancelCreate();
          }}
          onCreated={(created, secretValue) => {
            onCreated();
            setAfterSecret(created.id);
            setSecret({
              title: 'Inbound source created',
              label: created.verification === 'token' ? 'Token' : 'Signing secret',
              value: secretValue,
              note: 'Senders use it to sign their requests. Next, send a sample request or paste one to map its fields.',
            });
          }}
        />
      )}
      <RotateSecretDialog endpoint={rotating} onClose={() => setRotating(null)} onSecret={setSecret} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'this source'}?`}
        description="Its URL stops working at once and senders get 404. Leads it created stay. The delivery log keeps its past requests."
        confirmLabel="Delete source"
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
      <SecretOnceDialog
        secret={secret}
        onClose={() => {
          setSecret(null);
          if (afterSecret) setEditing(afterSecret);
          setAfterSecret(null);
        }}
      />
    </>
  );
}

function SourceCard({ source: s, onEdit, onRotate, onDelete, onShowLog }: { source: WebhookEndpoint; onEdit: () => void; onRotate: () => void; onDelete: () => void; onShowLog: () => void }) {
  const now = useNow(5_000);
  const me = useMe();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const canManage = useCan('webhooks.manage');
  const { reason } = useReadOnly();
  const m = useWebhookMutations();
  const [help, setHelp] = useState(false);
  const capturing = !!s.captureUntil && now > 0 && new Date(s.captureUntil).getTime() > now;
  const titleId = `source-${s.id}`;
  const fields = s.mapping?.fields.length ?? 0;
  const fail = (e: unknown) => toast.error(formErrorMessage(e));

  return (
    <li>
      <Card className="flex h-full flex-col" data-source-key={s.sourceKey ?? undefined}>
        <section aria-labelledby={titleId} className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 id={titleId} className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-fg">
                {s.name}
                {s.isActive ? <Chip tone="green">Active</Chip> : <Chip tone="grey">Paused</Chip>}
                <Chip tone="neutral">{s.verification === 'token' ? 'Token' : 'Signed'}</Chip>
                {capturing && (
                  <Chip tone="blue" dot>
                    Capturing a sample
                  </Chip>
                )}
              </h2>
              <p className="mt-0.5 text-xs text-muted-strong">
                {INBOUND_ACTION_LABEL[s.action ?? 'create_lead']}
                {s.action !== 'start_workflow' ? ` · ${fields} mapped ${fields === 1 ? 'field' : 'fields'}` : ''}
              </p>
            </div>
            {canManage && (
              <Switch
                aria-label={s.isActive ? `Pause ${s.name}` : `Turn on ${s.name}`}
                checked={s.isActive}
                disabled={!!reason}
                onCheckedChange={(isActive) => m.update.mutate({ id: s.id, patch: { isActive } }, { onSuccess: () => toast.success(isActive ? `${s.name} is on` : `${s.name} is paused; requests get 404 until you turn it on`), onError: fail })}
              />
            )}
          </div>

          {s.inboundUrl && <CopyField label="URL" value={s.inboundUrl} what="URL" testId="inbound-url" />}

          {capturing && (
            <p className="flex flex-wrap items-center gap-2 rounded-md border border-status-blue-border bg-status-blue-bg px-3 py-2 text-xs text-status-blue-fg" role="status">
              <Radio aria-hidden className="size-3.5" />
              Waiting for a request until {formatDateTimeIn(s.captureUntil, tz)}. It is stored as the sample and not turned into a lead.
              {canManage && (
                <Button size="sm" variant="ghost" className="ml-auto" disabled={!!reason} onClick={() => m.capture.mutate({ id: s.id, enabled: false }, { onError: fail })}>
                  Stop
                </Button>
              )}
            </p>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-muted-strong">Last 24 hours</dt>
            <dd className="text-fg-secondary">
              {s.stats.deliveries24h} {s.stats.deliveries24h === 1 ? 'request' : 'requests'}
              {s.stats.failures24h > 0 && <span className="text-danger-text">, {s.stats.failures24h} rejected or failed</span>}
            </dd>
            <dt className="text-muted-strong">Last request</dt>
            <dd className="text-fg-secondary">{s.lastDeliveryAt ? ago(s.lastDeliveryAt, now) : 'None yet'}</dd>
            <dt className="text-muted-strong">Sample</dt>
            <dd className="text-fg-secondary">{s.sampleCapturedAt ? `captured ${ago(s.sampleCapturedAt, now)}` : s.samplePayload ? 'pasted' : 'none'}</dd>
            <dt className="text-muted-strong">Secret</dt>
            <dd className="font-mono text-fg-secondary">
              {s.secretPreview}
              {s.previousSecretExpiresAt && new Date(s.previousSecretExpiresAt).getTime() > now && <span className="font-sans text-muted-strong"> (old one works until {formatDateTimeIn(s.previousSecretExpiresAt, tz)})</span>}
            </dd>
          </dl>

          {help && s.inboundUrl && (
            <div className="rounded-md border border-border p-3">
              <InboundSignatureHelp url={s.inboundUrl} sample={s.samplePayload ?? undefined} verification={s.verification} />
            </div>
          )}
        </section>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-3">
          {canManage && (
            <Button size="sm" onClick={onEdit}>
              <Pencil aria-hidden />
              Edit mapping
            </Button>
          )}
          <Button size="sm" variant="ghost" aria-expanded={help} onClick={() => setHelp((h) => !h)}>
            <Code2 aria-hidden />
            {s.verification === 'token' ? 'How to send' : 'How to sign'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onShowLog}>
            <History aria-hidden />
            Log
          </Button>
          {canManage && (
            <>
              {!capturing && (
                <Button size="sm" variant="ghost" disabled={!!reason} onClick={() => m.capture.mutate({ id: s.id, enabled: true }, { onSuccess: () => toast.success('Capture on: send one request to the URL'), onError: fail })}>
                  <Radio aria-hidden />
                  Capture a sample
                </Button>
              )}
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
