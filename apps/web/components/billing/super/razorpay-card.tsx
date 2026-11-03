'use client';

import { RazorpayConfigUpdateSchema, type RazorpayMode } from '@vistar/shared';
import { Check, Copy, CreditCard, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Segmented } from '@/components/dashboard/segmented';
import { Switch } from '@/components/common/switch';
import { InlineAlert } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useRazorpayConfig, useRazorpayMutations } from '@/lib/billing/hooks';
import { formErrorMessage, focusFirstInvalid, serverFieldErrors } from '@/lib/crm/ui/errors';
import { useCan } from '@/lib/session/session';

/**
 * Super Admin > Config > Razorpay (D-072): key id, mode (test or live), key secret and webhook secret.
 * Secrets are write-only (stored encrypted by the API; only the last 4 characters of the key secret come
 * back). The webhook URL is shown to copy into the Razorpay dashboard.
 */
export function RazorpayCard() {
  const can = useCan('platform.system.manage');
  const q = useRazorpayConfig();
  const m = useRazorpayMutations();
  const formId = `razorpay-${useId().replace(/:/g, '')}`;
  const [edit, setEdit] = useState<{ mode: RazorpayMode; keyId: string; keySecret: string; webhookSecret: string; enabled: boolean } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!can) return null;
  const s = q.data;

  const startEdit = () => {
    setErrors({});
    setFormError(null);
    setEdit({ mode: s?.mode ?? 'test', keyId: s?.keyId ?? '', keySecret: '', webhookSecret: '', enabled: s?.enabled ?? true });
  };

  const save = async () => {
    if (!edit) return;
    const body = { mode: edit.mode, keyId: edit.keyId.trim(), enabled: edit.enabled, ...(edit.keySecret.trim() ? { keySecret: edit.keySecret.trim() } : {}), ...(edit.webhookSecret.trim() ? { webhookSecret: edit.webhookSecret.trim() } : {}) };
    const parsed = RazorpayConfigUpdateSchema.safeParse(body);
    const e: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) e[i.path.join('.') || 'keyId'] = i.message;
    if (!s?.configured && !edit.keySecret.trim()) e.keySecret = 'Enter the key secret (needed the first time).';
    if (!s?.configured && !edit.webhookSecret.trim()) e.webhookSecret = 'Enter the webhook secret (needed the first time).';
    setErrors(e);
    setFormError(null);
    if (Object.keys(e).length) {
      focusFirstInvalid(formId);
      return;
    }
    try {
      await m.save.mutateAsync(body);
      toast.success(`Razorpay saved (${edit.mode} mode)`);
      setEdit(null);
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFormError(formErrorMessage(err));
      focusFirstInvalid(formId);
    }
  };

  const copy = async () => {
    if (!s) return;
    try {
      await navigator.clipboard.writeText(s.webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy did not work. Select the address and copy it.');
    }
  };

  return (
    <Card aria-labelledby="razorpay-title">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          <CreditCard aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />
          <div>
            <CardTitle id="razorpay-title">Razorpay</CardTitle>
            <CardDescription>Online payments for Vistar invoices (cards, UPI, net banking). Without it, companies send plan requests and you record bank transfers.</CardDescription>
          </div>
        </div>
        {s && (
          <Chip tone={s.activeProvider === 'razorpay' ? (s.mode === 'live' ? 'green' : 'blue') : s.activeProvider === 'mock' ? 'amber' : 'grey'} dot>
            {s.activeProvider === 'razorpay' ? `${s.mode === 'live' ? 'Live' : 'Test'} mode` : s.activeProvider === 'mock' ? 'Test provider (development)' : 'Not set up'}
          </Chip>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {q.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : q.isError || !s ? (
          <InlineAlert>
            The Razorpay settings did not load.{' '}
            <Button size="sm" variant="link" className="h-auto p-0" onClick={() => void q.refetch()}>
              Try again
            </Button>
          </InlineAlert>
        ) : edit ? (
          <form
            id={formId}
            noValidate
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {formError && <InlineAlert>{formError}</InlineAlert>}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-fg">Mode</span>
              <Segmented
                label="Razorpay mode"
                value={edit.mode}
                onChange={(mode) => setEdit({ ...edit, mode })}
                options={[
                  { value: 'test', label: 'Test' },
                  { value: 'live', label: 'Live' },
                ]}
              />
              {edit.mode === 'live' && <Chip tone="amber">Live mode takes real money</Chip>}
            </div>
            <FormField label="Key id" required error={errors.keyId} hint={`Starts with rzp_${edit.mode}_ (Razorpay dashboard > Settings > API keys).`}>
              <Input value={edit.keyId} autoComplete="off" spellCheck={false} className="font-mono" onChange={(e) => setEdit({ ...edit, keyId: e.target.value })} />
            </FormField>
            <FormField label="Key secret" required={!s.configured} error={errors.keySecret} hint={s.keySecretLast4 ? `Saved, ends in ${s.keySecretLast4}. Leave empty to keep it.` : 'Shown once in Razorpay when you create the key.'}>
              <Input type="password" value={edit.keySecret} autoComplete="new-password" spellCheck={false} onChange={(e) => setEdit({ ...edit, keySecret: e.target.value })} />
            </FormField>
            <FormField label="Webhook secret" required={!s.configured} error={errors.webhookSecret} hint={s.webhookSecretSet ? 'Saved. Leave empty to keep it.' : 'The secret you type when you add the webhook in Razorpay.'}>
              <Input type="password" value={edit.webhookSecret} autoComplete="new-password" spellCheck={false} onChange={(e) => setEdit({ ...edit, webhookSecret: e.target.value })} />
            </FormField>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={edit.enabled} onCheckedChange={(enabled) => setEdit({ ...edit, enabled })} />
              Use Razorpay for checkout
            </label>
          </form>
        ) : (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-strong">Key id</dt>
              <dd className="font-mono text-xs text-fg">{s.keyId ?? 'Not set'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-strong">Secrets</dt>
              <dd className="text-fg">{s.configured ? `Key secret ending ${s.keySecretLast4 ?? '????'} · webhook secret ${s.webhookSecretSet ? 'set' : 'missing'}` : 'Not set'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-strong">Last webhook</dt>
              <dd className="text-fg">{s.lastWebhookAt ? new Date(s.lastWebhookAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'None received yet'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-strong">Status</dt>
              <dd className="text-fg">{s.configured ? (s.enabled ? 'Used for checkout' : 'Saved, switched off') : 'Not set up'}</dd>
            </div>
          </dl>
        )}
        {s && (
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-2 p-3">
            <span id={`${formId}-hook`} className="text-xs font-medium text-fg-secondary">
              Webhook URL (Razorpay dashboard &gt; Webhooks; events payment.captured, payment.failed, order.paid)
            </span>
            <div className="flex items-center gap-2">
              <code aria-labelledby={`${formId}-hook`} className="min-w-0 flex-1 truncate font-mono text-xs text-fg">
                {s.webhookUrl}
              </code>
              <Button size="sm" variant="ghost" onClick={() => void copy()} aria-label="Copy the webhook URL">
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
      {s && (
        <CardFooter className="justify-end gap-2">
          {edit ? (
            <>
              <Button onClick={() => setEdit(null)} disabled={m.save.isPending}>
                Cancel
              </Button>
              <Button type="submit" form={formId} variant="primary" loading={m.save.isPending}>
                Save Razorpay
              </Button>
            </>
          ) : (
            <>
              {s.configured && (
                <Button variant="ghost" onClick={() => setConfirmRemove(true)}>
                  <Trash2 aria-hidden />
                  Remove
                </Button>
              )}
              <Button variant="primary" onClick={startEdit}>
                {s.configured ? 'Edit' : 'Set up Razorpay'}
              </Button>
            </>
          )}
        </CardFooter>
      )}
      <Dialog open={confirmRemove} onOpenChange={(o) => !m.remove.isPending && setConfirmRemove(o)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Remove Razorpay?</DialogTitle>
            <DialogDescription>Companies can no longer pay online. Plan upgrades become requests, and you record bank transfers by hand.</DialogDescription>
          </DialogHeader>
          <DialogBody />
          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={m.remove.isPending}>Keep it</Button>
            </DialogClose>
            <Button
              variant="danger"
              loading={m.remove.isPending}
              onClick={async () => {
                try {
                  await m.remove.mutateAsync();
                  toast.success('Razorpay removed');
                  setConfirmRemove(false);
                } catch (err) {
                  toast.error(formErrorMessage(err, 'Razorpay was not removed. Try again.'));
                }
              }}
            >
              Remove Razorpay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
