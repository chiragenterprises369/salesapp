'use client';

import { API_KEY_DEFAULT_RATE_LIMIT_PER_MIN, API_KEY_MAX_RATE_LIMIT_PER_MIN, type ApiKeyCreated, type ApiKeyScope, type ApiKeyScopeOption } from '@vistar/shared';
import { X } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/leads/primitives/sheet';
import { Checkbox, CheckboxRow } from '@/components/settings/common/checkbox';
import { InlineAlert } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useReadOnly } from '@/lib/auth/use-auth';
import { addDays, dayKeyIn, parseDayKey, zonedToUtc } from '@/lib/crm/tz';
import { useNow } from '@/components/common/use-now';
import { FormSection } from '@/lib/crm/ui/fields';
import { formErrorMessage, serverFieldErrors } from '@/lib/crm/ui/errors';
import { useApiKeyMutations, useApiKeyScopes } from '@/lib/hub/api-keys';
import { useMe } from '@/lib/session/session';

const RESOURCE_LABEL: Record<string, string> = { leads: 'Leads', tasks: 'Tasks', calls: 'Calls', messages: 'WhatsApp messages', workflows: 'Workflows' };
const EXPIRY = [
  { value: 'never', label: 'Never' },
  { value: '30', label: 'In 30 days' },
  { value: '90', label: 'In 90 days' },
  { value: '365', label: 'In 1 year' },
  { value: 'date', label: 'On a date' },
] as const;

/**
 * New API key: name, expiry, scopes grouped by resource (only permissions the creator holds can be
 * picked, the rest are shown disabled with the reason) and an optional rate limit. The created key is
 * returned to `onCreated` to show once.
 */
export function CreateKeySheet({ onClose, onCreated }: { onClose: () => void; onCreated: (k: ApiKeyCreated) => void }) {
  const formId = useId().replace(/:/g, '');
  const me = useMe()!;
  const tz = me.workspace.timezone ?? 'Asia/Kolkata';
  const scopes = useApiKeyScopes();
  const m = useApiKeyMutations();
  const { reason } = useReadOnly();
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]['value']>('90');
  const [date, setDate] = useState('');
  const [picked, setPicked] = useState<Set<ApiKeyScope>>(new Set());
  const [rate, setRate] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const now = useNow(60_000);
  const today = dayKeyIn(now, tz);

  const groups = useMemo(() => {
    const out = new Map<string, ApiKeyScopeOption[]>();
    for (const o of scopes.data?.items ?? []) out.set(o.resource, [...(out.get(o.resource) ?? []), o]);
    return [...out.entries()];
  }, [scopes.data]);

  const toggle = (s: ApiKeyScope, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(s);
      else next.delete(s);
      return next;
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Name the key after what uses it, for example Website or Tally.';
    if (picked.size === 0) next.scopes = 'Pick at least one scope.';
    if (expiry === 'date' && (!date || date <= today)) next.expiresAt = 'Pick a date after today.';
    const rateNum = rate ? Number(rate) : undefined;
    if (rateNum !== undefined && (!Number.isInteger(rateNum) || rateNum < 10 || rateNum > API_KEY_MAX_RATE_LIMIT_PER_MIN)) next.rate = `Enter 10 to ${API_KEY_MAX_RATE_LIMIT_PER_MIN} requests a minute, or leave it empty.`;
    setErrors(next);
    if (Object.keys(next).length) return;
    const expiresAt =
      expiry === 'never' ? undefined : expiry === 'date' ? zonedToUtc({ ...parseDayKey(date), hour: 23, minute: 59 }, tz).toISOString() : zonedToUtc({ ...parseDayKey(addDays(today, Number(expiry))), hour: 23, minute: 59 }, tz).toISOString();
    try {
      const created = await m.create.mutateAsync({ name: name.trim(), scopes: [...picked], ...(expiresAt ? { expiresAt } : {}), ...(rateNum ? { rateLimitPerMinute: rateNum } : {}) });
      onCreated(created);
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFormError(formErrorMessage(err));
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg" aria-describedby={`${formId}-desc`}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <SheetTitle className="text-base font-semibold text-fg">New API key</SheetTitle>
            <SheetDescription id={`${formId}-desc`} className="mt-0.5 text-sm text-muted-strong">
              A key lets another system use the Vistar API for this workspace. Give it only the scopes it needs.
            </SheetDescription>
          </div>
          <SheetClose asChild>
            <Button size="icon" variant="ghost" aria-label="Close">
              <X aria-hidden />
            </Button>
          </SheetClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-6">
            {formError && <InlineAlert>{formError}</InlineAlert>}
            <FormSection title="Key">
              <FormField label="Name" required error={errors.name}>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Website contact form" maxLength={80} />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Expires" error={expiry !== 'date' ? errors.expiresAt : undefined}>
                  <NativeSelect value={expiry} onChange={(e) => setExpiry(e.target.value as typeof expiry)}>
                    {EXPIRY.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                {expiry === 'date' && (
                  <FormField label="Expiry date" required error={errors.expiresAt}>
                    <Input type="date" value={date} min={addDays(today, 1)} onChange={(e) => setDate(e.target.value)} />
                  </FormField>
                )}
              </div>
              <FormField label="Rate limit (requests a minute)" hint={`Empty = ${API_KEY_DEFAULT_RATE_LIMIT_PER_MIN}. Above it the API answers 429 with Retry-After.`} error={errors.rate ?? errors.rateLimitPerMinute}>
                <Input inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value.replace(/\D/g, ''))} placeholder={String(API_KEY_DEFAULT_RATE_LIMIT_PER_MIN)} className="sm:max-w-40" />
              </FormField>
            </FormSection>

            <FormSection title="Scopes" description="A key can never do more than you can. Scopes you do not hold are switched off.">
              {(errors.scopes || errors['scopes.0']) && (
                <p role="alert" className="text-xs text-danger-text">
                  {errors.scopes ?? errors['scopes.0']}
                </p>
              )}
              {scopes.isPending ? (
                <div role="status" aria-label="Loading scopes" className="flex flex-col gap-2">
                  {Array.from({ length: 4 }, (_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : scopes.isError ? (
                <InlineAlert title="Scopes did not load">
                  <Button size="sm" onClick={() => void scopes.refetch()}>
                    Try again
                  </Button>
                </InlineAlert>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {groups.map(([resource, opts]) => {
                    const allowed = opts.filter((o) => o.allowed);
                    const on = allowed.filter((o) => picked.has(o.scope)).length;
                    const gid = `${formId}-${resource}`;
                    return (
                      <fieldset key={resource} className="flex flex-col gap-1 rounded-md border border-border p-3">
                        <legend className="sr-only">{RESOURCE_LABEL[resource] ?? resource}</legend>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={gid}
                            disabled={allowed.length === 0 || !!reason}
                            checked={on === 0 ? false : on === allowed.length ? true : 'indeterminate'}
                            onCheckedChange={(v) => allowed.forEach((o) => toggle(o.scope, v === true))}
                            aria-label={`All ${RESOURCE_LABEL[resource] ?? resource} scopes`}
                          />
                          <label htmlFor={gid} className="text-sm font-semibold text-fg">
                            {RESOURCE_LABEL[resource] ?? resource}
                          </label>
                        </div>
                        {opts.map((o) => (
                          <CheckboxRow
                            key={o.scope}
                            className="pl-6"
                            checked={picked.has(o.scope)}
                            disabled={!o.allowed || !!reason}
                            onCheckedChange={(v) => toggle(o.scope, v)}
                            label={
                              <span>
                                {o.label.split(': ').pop()} <code className="font-mono text-2xs text-muted-strong">{o.scope}</code>
                              </span>
                            }
                            hint={o.allowed ? undefined : 'Your role does not have this permission.'}
                          />
                        ))}
                      </fieldset>
                    );
                  })}
                </div>
              )}
            </FormSection>
          </form>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
          {reason && <p className="mr-auto text-xs text-muted-strong">{reason}</p>}
          <SheetClose asChild>
            <Button disabled={m.create.isPending} className="h-11 sm:h-8">
              Cancel
            </Button>
          </SheetClose>
          <Button type="submit" form={formId} variant="primary" loading={m.create.isPending} disabled={!!reason} className="h-11 sm:h-8">
            Create key
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
