'use client';

import { API_KEY_DEFAULT_RATE_LIMIT_PER_MIN, API_KEY_MAX_RATE_LIMIT_PER_MIN, API_KEY_ROTATION_GRACE_DEFAULT_MIN, API_KEY_ROTATION_GRACE_MAX_MIN, type ApiKey, type ApiKeyCreated } from '@vistar/shared';
import { BookOpen, KeyRound, Pencil, Plus, RotateCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { NativeSelect } from '@/components/common/native-select';
import { useMediaQuery } from '@/components/common/use-media-query';
import { useNow } from '@/components/common/use-now';
import { InlineAlert, ListSkeleton, LoadError } from '@/components/settings/common/states';
import { SettingsCard } from '@/components/settings/settings-card';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { isMockData } from '@/lib/api/data-source';
import { useReadOnly } from '@/lib/auth/use-auth';
import { ago, formatDateIn, formatDateTimeIn } from '@/lib/crm/format';
import { ConfirmDialog } from '@/lib/crm/ui/confirm-dialog';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { useApiKeyMutations, useApiKeys } from '@/lib/hub/api-keys';
import { apiBaseUrl } from '@/lib/hub/docs';
import { apiKeyCurl } from '@/lib/hub/snippets';
import { CodeBlock } from '@/lib/hub/ui/copy';
import { SecretOnceDialog, type ShownOnceSecret } from '@/lib/hub/ui/secret-once';
import { useMe } from '@/lib/session/session';
import { CreateKeySheet } from './create-key-sheet';

const STATUS: Record<ApiKey['status'], { label: string; tone: 'green' | 'grey' | 'red' }> = {
  active: { label: 'Active', tone: 'green' },
  expired: { label: 'Expired', tone: 'grey' },
  revoked: { label: 'Revoked', tone: 'red' },
};
const GRACE_CHOICES = [0, 15, 60, 240, 1440].filter((m) => m <= API_KEY_ROTATION_GRACE_MAX_MIN);
const graceLabel = (m: number) => (m === 0 ? 'No time (stop it now)' : m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : m < 1440 ? `${m / 60} hours` : '24 hours');

/** Settings > API keys: list with scopes, last use and expiry; create (shown once), edit, rotate with grace, revoke. */
export function ApiKeysSettings() {
  const me = useMe()!;
  const q = useApiKeys();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<ShownOnceSecret | null>(null);
  const [rotating, setRotating] = useState<ApiKey | null>(null);
  const [editing, setEditing] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const { reason } = useReadOnly();
  const planOff = me.workspace.features?.api_access === false;
  const base = apiBaseUrl(undefined);

  const shown = (k: ApiKeyCreated, title: string, note?: string) =>
    setSecret({
      title,
      label: 'API key',
      value: k.key,
      note: note ?? `Send it as "Authorization: Bearer ${k.prefix}…". Scopes: ${k.scopes.join(', ')}.`,
      extra: <CodeBlock title="Try it" language="bash" code={apiKeyCurl(base)} what="Example command" />,
    });

  if (isMockData())
    return (
      <InlineAlert tone="info" title="API keys need the Vistar API">
        This build runs on sample data for automated tests. Create keys on a build that uses the API.
      </InlineAlert>
    );

  const keys = q.data?.items ?? [];
  const active = keys.filter((k) => k.status === 'active');
  const inactive = keys.filter((k) => k.status !== 'active');
  return (
    <>
      {planOff && (
        <InlineAlert tone="info" title="Your plan does not include API access">
          Existing keys are listed below, but new ones cannot be created. Ask the account owner to upgrade the plan.
        </InlineAlert>
      )}
      <SettingsCard
        title="Keys"
        description="Keys let your website, ERP or scripts read and create leads and tasks through the API. Each key only reaches what its scopes allow, and every use is recorded."
        footer={
          <Button variant="primary" onClick={() => setCreating(true)} disabled={!!reason || planOff}>
            <Plus aria-hidden />
            New API key
          </Button>
        }
      >
        {q.isPending ? (
          <ListSkeleton rows={2} label="Loading API keys" />
        ) : q.isError ? (
          <LoadError title="API keys did not load" onRetry={() => void q.refetch()} />
        ) : keys.length === 0 ? (
          <EmptyState size="sm" icon={<KeyRound />} title="No API keys yet" description="Create a key for each system that talks to Vistar, so you can rotate or revoke one without touching the others." />
        ) : (
          <div className="flex flex-col gap-4">
            <KeyList keys={active} onRotate={setRotating} onEdit={setEditing} onRevoke={setRevoking} />
            {inactive.length > 0 && (
              <details className="group">
                <summary className="focus-ring cursor-pointer rounded-sm text-xs font-medium text-fg-secondary">
                  {inactive.length} revoked or expired {inactive.length === 1 ? 'key' : 'keys'}
                </summary>
                <div className="mt-2">
                  <KeyList keys={inactive} onRotate={setRotating} onEdit={setEditing} onRevoke={setRevoking} />
                </div>
              </details>
            )}
          </div>
        )}
      </SettingsCard>
      <SettingsCard title="Use a key" description="Send the key as a Bearer token. Requests above the key's rate limit get 429 with Retry-After.">
        <div className="flex flex-col gap-3">
          <CodeBlock title="List the newest leads" language="bash" code={apiKeyCurl(base)} what="Example command" />
          <div>
            <Button size="sm" asChild>
              <Link href="/app/settings/api-docs">
                <BookOpen aria-hidden />
                Open the API docs
              </Link>
            </Button>
          </div>
        </div>
      </SettingsCard>

      {creating && (
        <CreateKeySheet
          onClose={() => setCreating(false)}
          onCreated={(k) => {
            setCreating(false);
            toast.success(`${k.name} created`);
            shown(k, 'API key created');
          }}
        />
      )}
      <RotateKeyDialog keyItem={rotating} onClose={() => setRotating(null)} onRotated={(k) => shown(k, 'New key for ' + k.name, k.previousKeyExpiresAt ? `The old key keeps working until ${formatDateTimeIn(k.previousKeyExpiresAt, me.workspace.timezone ?? 'Asia/Kolkata')}. Update the system that uses it before then.` : 'The old key stopped working now.')} />
      <EditKeyDialog keyItem={editing} onClose={() => setEditing(null)} />
      <RevokeKeyDialog keyItem={revoking} onClose={() => setRevoking(null)} />
      <SecretOnceDialog secret={secret} onClose={() => setSecret(null)} />
    </>
  );
}

function KeyList({ keys, onRotate, onEdit, onRevoke }: { keys: ApiKey[]; onRotate: (k: ApiKey) => void; onEdit: (k: ApiKey) => void; onRevoke: (k: ApiKey) => void }) {
  const me = useMe()!;
  const tz = me.workspace.timezone ?? 'Asia/Kolkata';
  const now = useNow(60_000);
  const wide = useMediaQuery('(min-width: 1024px)');
  const { reason } = useReadOnly();
  if (!keys.length) return <p className="text-sm text-muted-strong">No active keys.</p>;
  const actions = (k: ApiKey) =>
    k.status === 'active' ? (
      <div className="flex items-center justify-end gap-0.5">
        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${k.name}`} onClick={() => onEdit(k)} disabled={!!reason}>
          <Pencil aria-hidden />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={`Rotate ${k.name}`} onClick={() => onRotate(k)} disabled={!!reason}>
          <RotateCw aria-hidden />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={`Revoke ${k.name}`} onClick={() => onRevoke(k)} disabled={!!reason}>
          <Trash2 aria-hidden />
        </Button>
      </div>
    ) : null;
  const lastUsed = (k: ApiKey) => (k.lastUsedAt ? `${ago(k.lastUsedAt, now)}${k.lastUsedIp ? ` from ${k.lastUsedIp}` : ''}` : 'Never used');
  const expires = (k: ApiKey) => (k.revokedAt ? `Revoked ${formatDateIn(k.revokedAt, tz)}` : k.expiresAt ? `${k.status === 'expired' ? 'Expired' : 'Expires'} ${formatDateIn(k.expiresAt, tz)}` : 'Never expires');
  const scopes = (k: ApiKey) => (
    <ul className="flex flex-wrap gap-1" aria-label={`Scopes of ${k.name}`}>
      {k.scopes.map((s) => (
        <li key={s}>
          <Chip tone="neutral" className="font-mono">
            {s}
          </Chip>
        </li>
      ))}
    </ul>
  );
  if (!wide)
    return (
      <ul className="flex flex-col divide-y divide-border" aria-label="API keys">
        {keys.map((k) => (
          <li key={k.id} className="flex flex-col gap-1.5 py-3" data-api-key={k.prefix}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-fg">
                  {k.name}
                  <Chip tone={STATUS[k.status].tone}>{STATUS[k.status].label}</Chip>
                </p>
                <p className="font-mono text-xs text-muted-strong">{k.prefix}…</p>
              </div>
              {actions(k)}
            </div>
            {scopes(k)}
            <p className="text-xs text-muted-strong">
              {lastUsed(k)} · {expires(k)} · {(k.rateLimitPerMinute ?? API_KEY_DEFAULT_RATE_LIMIT_PER_MIN).toLocaleString('en-IN')} a minute
            </p>
          </li>
        ))}
      </ul>
    );
  return (
    <Table aria-label="API keys">
      <TableHeader sticky={false}>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Key</TableHead>
          <TableHead>Scopes</TableHead>
          <TableHead>Last used</TableHead>
          <TableHead>Expiry</TableHead>
          <TableHead className="text-right">Limit</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((k) => (
          <TableRow key={k.id} data-api-key={k.prefix}>
            <TableCell>
              <span className="flex items-center gap-1.5 font-medium">
                {k.name}
                <Chip tone={STATUS[k.status].tone}>{STATUS[k.status].label}</Chip>
              </span>
              {k.createdBy && <span className="block text-2xs text-muted-strong">by {k.createdBy.name}</span>}
            </TableCell>
            <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
            <TableCell className="max-w-80 whitespace-normal">{scopes(k)}</TableCell>
            <TableCell className="text-fg-secondary">{lastUsed(k)}</TableCell>
            <TableCell className="text-fg-secondary">
              {expires(k)}
              {k.previousKeyExpiresAt && now > 0 && new Date(k.previousKeyExpiresAt).getTime() > now && <span className="block text-2xs text-muted-strong">Old key works until {formatDateTimeIn(k.previousKeyExpiresAt, tz)}</span>}
            </TableCell>
            <TableCell className="tabular text-right text-fg-secondary">{(k.rateLimitPerMinute ?? API_KEY_DEFAULT_RATE_LIMIT_PER_MIN).toLocaleString('en-IN')}/min</TableCell>
            <TableCell>{actions(k)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RotateKeyDialog({ keyItem, onClose, onRotated }: { keyItem: ApiKey | null; onClose: () => void; onRotated: (k: ApiKeyCreated) => void }) {
  const m = useApiKeyMutations();
  const [grace, setGrace] = useState(String(API_KEY_ROTATION_GRACE_DEFAULT_MIN));
  return (
    <ConfirmDialog
      open={!!keyItem}
      onOpenChange={(o) => !o && onClose()}
      tone="primary"
      title={`Rotate ${keyItem?.name ?? 'this key'}?`}
      description="Vistar makes a new key with the same scopes. Put it into the system that uses this key before the old one stops working."
      confirmLabel="Rotate key"
      loading={m.rotate.isPending}
      onConfirm={() =>
        keyItem &&
        m.rotate.mutate(
          { id: keyItem.id, graceMinutes: Number(grace) },
          {
            onSuccess: (k) => {
              onClose();
              onRotated(k);
            },
            onError: (e) => toast.error(formErrorMessage(e, 'The key was not rotated. Try again.')),
          },
        )
      }
    >
      <FormField label="Keep the old key working for">
        <NativeSelect value={grace} onChange={(e) => setGrace(e.target.value)}>
          {GRACE_CHOICES.map((g) => (
            <option key={g} value={g}>
              {graceLabel(g)}
            </option>
          ))}
        </NativeSelect>
      </FormField>
    </ConfirmDialog>
  );
}

function EditKeyDialog({ keyItem, onClose }: { keyItem: ApiKey | null; onClose: () => void }) {
  return (
    <Dialog open={!!keyItem} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">{keyItem && <EditKeyForm key={keyItem.id} keyItem={keyItem} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function EditKeyForm({ keyItem, onClose }: { keyItem: ApiKey; onClose: () => void }) {
  const m = useApiKeyMutations();
  const [name, setName] = useState(keyItem.name);
  const [rate, setRate] = useState(keyItem.rateLimitPerMinute ? String(keyItem.rateLimitPerMinute) : '');
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const r = rate ? Number(rate) : null;
    if (!name.trim()) return setError('Enter a name.');
    if (r !== null && (r < 10 || r > API_KEY_MAX_RATE_LIMIT_PER_MIN)) return setError(`Enter 10 to ${API_KEY_MAX_RATE_LIMIT_PER_MIN} requests a minute, or leave it empty.`);
    m.update.mutate(
      { id: keyItem.id, patch: { name: name.trim(), rateLimitPerMinute: r } },
      {
        onSuccess: () => {
          toast.success('Key saved');
          onClose();
        },
        onError: (e) => setError(formErrorMessage(e)),
      },
    );
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit {keyItem.name}</DialogTitle>
        <DialogDescription>Scopes cannot change; create a new key for other scopes.</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        {error && <InlineAlert>{error}</InlineAlert>}
        <FormField label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </FormField>
        <FormField label="Rate limit (requests a minute)" hint={`Empty = ${API_KEY_DEFAULT_RATE_LIMIT_PER_MIN}.`}>
          <Input inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value.replace(/\D/g, ''))} placeholder={String(API_KEY_DEFAULT_RATE_LIMIT_PER_MIN)} />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button disabled={m.update.isPending}>Cancel</Button>
        </DialogClose>
        <Button variant="primary" loading={m.update.isPending} onClick={save}>
          Save changes
        </Button>
      </DialogFooter>
    </>
  );
}

function RevokeKeyDialog({ keyItem, onClose }: { keyItem: ApiKey | null; onClose: () => void }) {
  const m = useApiKeyMutations();
  return (
    <ConfirmDialog
      open={!!keyItem}
      onOpenChange={(o) => !o && onClose()}
      title={`Revoke ${keyItem?.name ?? 'this key'}?`}
      description="Requests with this key fail from now on (401). This cannot be undone; create a new key if you need access again."
      confirmLabel="Revoke key"
      loading={m.revoke.isPending}
      onConfirm={() =>
        keyItem &&
        m.revoke.mutate(keyItem.id, {
          onSuccess: () => {
            toast.success(`${keyItem.name} revoked`);
            onClose();
          },
          onError: (e) => toast.error(formErrorMessage(e)),
        })
      }
    />
  );
}
