'use client';

import type { IntegrationField, IntegrationMode } from '@vistar/shared';
import { CheckCircle2, ExternalLink, FlaskConical, KeyRound, RotateCw, X, XCircle } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Segmented } from '@/components/dashboard/segmented';
import { NativeSelect } from '@/components/common/native-select';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/leads/primitives/sheet';
import { CheckboxRow } from '@/components/settings/common/checkbox';
import { InlineAlert } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { ConfirmDialog } from '@/lib/crm/ui/confirm-dialog';
import { formErrorMessage, serverFieldErrors } from '@/lib/crm/ui/errors';
import { INTEGRATION_STATUS, statusOf } from '@/lib/hub/format';
import { useIntegrationMutations } from '@/lib/hub/integrations';
import { CopyField } from '@/lib/hub/ui/copy';
import { useMe } from '@/lib/session/session';
import { configValue, initialFieldValue, visibleFields, type FieldValue } from './providers';
import type { IntegrationView } from './view';

type Values = Record<string, FieldValue>;

function initialValues(view: IntegrationView): Values {
  const out: Values = {};
  for (const f of view.info?.fields ?? []) if (!f.secret) out[f.key] = initialFieldValue(f, view.row.config[f.key]);
  return out;
}

interface Outcome {
  ok: boolean;
  message: string;
  latencyMs: number | null;
}

/**
 * Connect or update one provider: setup steps, live or test (mock) mode, the provider's fields
 * (secret fields are write-only: once stored they show a masked hint with Replace), the URLs and
 * tokens to paste on the provider's side, and a connection test. Saving runs the test too, so the
 * status that comes back is the real one.
 */
export function ConnectSheet({ view, onClose }: { view: IntegrationView; onClose: () => void }) {
  const formId = useId().replace(/:/g, '');
  const me = useMe();
  const m = useIntegrationMutations();
  const { reason } = useReadOnly();
  const info = view.info;
  const row = view.row;
  const mockAllowed = !!info?.capabilities.mock;
  const [mode, setMode] = useState<IntegrationMode>(row.mode ?? 'live');
  const [values, setValues] = useState<Values>(() => initialValues(view));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [testTo, setTestTo] = useState(me?.user.email ?? '');
  const [confirmToken, setConfirmToken] = useState(false);

  const fields = visibleFields(info?.fields ?? [], values);
  const live = mode === 'live';
  const hasStored = (f: IntegrationField) => f.secret && !!row.secretHints[f.key] && !replacing[f.key];
  const blocked = reason ?? (live ? view.blockedReason : null);
  const status = statusOf(INTEGRATION_STATUS, row.status);
  const oauth = !!info?.capabilities.oauth && live;

  const set = (key: string, v: FieldValue) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((prev) => ({ ...prev, [key]: '' }));
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (live)
      for (const f of fields) {
        const label = f.label.charAt(0).toLowerCase() + f.label.slice(1);
        if (f.secret) {
          if (f.required && !hasStored(f) && !secrets[f.key]?.trim()) next[f.key] = `Enter the ${label}.`;
          continue;
        }
        const v = values[f.key];
        if (f.required && f.type !== 'boolean' && (v === undefined || v === '' || (Array.isArray(v) && !v.length))) next[f.key] = `Enter the ${label}.`;
        else if (f.type === 'number' && typeof v === 'string' && v && !/^\d+$/.test(v)) next[f.key] = 'Enter a whole number.';
        else if (f.type === 'email' && typeof v === 'string' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) next[f.key] = 'Enter an email address like sales@yourcompany.in.';
      }
    setErrors(next);
    return !Object.values(next).some(Boolean);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setOutcome(null);
    if (!validate()) return;
    const config: Record<string, unknown> = {};
    for (const f of fields)
      if (!f.secret) {
        const v = configValue(f, values[f.key]);
        if (v !== undefined) config[f.key] = v;
      }
    const secretBody: Record<string, string> = {};
    if (live) for (const f of fields) if (f.secret && secrets[f.key]?.trim()) secretBody[f.key] = secrets[f.key]!.trim();
    try {
      const saved = await m.connect.mutateAsync({ provider: view.provider, body: { mode, config, secrets: secretBody, test: true } });
      setSecrets({});
      setReplacing({});
      if (saved.status === 'connected') {
        toast.success(`${view.name} connected${mode === 'mock' ? ' in test mode' : ''}`);
        onClose();
      } else {
        setFormError(saved.attention ?? saved.lastError ?? `${view.name} is saved but not connected yet. Check the details and test again.`);
      }
    } catch (err) {
      const fe = serverFieldErrors(err);
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(fe)) mapped[k.replace(/^(config|secrets)\./, '')] = v;
      setErrors(mapped);
      setFormError(formErrorMessage(err));
    }
  };

  const runTest = async () => {
    setOutcome(null);
    try {
      const r = await m.test.mutateAsync({ provider: view.provider, to: view.provider === 'smtp' && testTo.trim() ? testTo.trim() : undefined });
      setOutcome({ ok: r.ok, message: r.message, latencyMs: r.latencyMs });
    } catch (err) {
      setOutcome({ ok: false, message: formErrorMessage(err, 'The test did not run. Try again.'), latencyMs: null });
    }
  };

  const startOauth = async () => {
    setFormError(null);
    try {
      const r = await m.oauthStart.mutateAsync(view.provider);
      if (/^https:\/\//.test(r.authUrl)) window.location.assign(r.authUrl);
      else setFormError('The sign-in address from the server is not valid. Contact support.');
    } catch (err) {
      setFormError(formErrorMessage(err));
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg" aria-describedby={`${formId}-desc`}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <SheetTitle className="text-base font-semibold text-fg">{view.configured ? `${view.name} settings` : `Connect ${view.name}`}</SheetTitle>
            <SheetDescription id={`${formId}-desc`} className="mt-0.5 text-sm text-muted-strong">
              {info?.description}
            </SheetDescription>
          </div>
          <SheetClose asChild>
            <Button size="icon" variant="ghost" aria-label="Close">
              <X aria-hidden />
            </Button>
          </SheetClose>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-5">
            {view.configured && (
              <p className="text-sm text-fg-secondary">
                Status: <span className="font-medium text-fg">{status.label}</span>
                {row.mode === 'mock' && ' (test mode)'}
                {row.connectedBy ? `, connected by ${row.connectedBy.name}` : ''}
              </p>
            )}
            {row.attention && <InlineAlert tone="warning">{row.attention}</InlineAlert>}

            {mockAllowed && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-fg-secondary" id={`${formId}-mode`}>
                  Mode
                </span>
                <Segmented
                  label="Mode"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'live', label: 'Live account' },
                    { value: 'mock', label: 'Test mode' },
                  ]}
                />
                <p className="text-xs text-muted">{live ? 'Uses your real account with the details below.' : 'Simulates the provider so you can try the flow without an account. Not available on production servers.'}</p>
              </div>
            )}

            {live && view.blockedReason && <InlineAlert tone="info">{view.blockedReason}</InlineAlert>}

            {live && info && info.setupSteps.length > 0 && (
              <section aria-labelledby={`${formId}-steps`}>
                <h3 id={`${formId}-steps`} className="mb-2 text-sm font-semibold text-fg">
                  How to set it up
                </h3>
                <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-fg-secondary marker:text-muted-strong">
                  {info.setupSteps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                {info.docsUrl && (
                  <a href={info.docsUrl} target="_blank" rel="noreferrer" className="focus-ring mt-2 inline-flex items-center gap-1 rounded-sm text-sm text-accent-text hover:underline">
                    Provider documentation
                    <ExternalLink aria-hidden className="size-3.5" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                )}
              </section>
            )}

            {view.copyables.length > 0 && (
              <section aria-labelledby={`${formId}-copy`} className="flex flex-col gap-3">
                <h3 id={`${formId}-copy`} className="text-sm font-semibold text-fg">
                  To paste on the {view.name} side
                </h3>
                {view.copyables.map((c) => (
                  <CopyField key={c.key} label={c.label} value={c.value} what={c.label} hint={c.hint} testId={`copy-${c.key}`} />
                ))}
                <div>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmToken(true)} disabled={!!reason}>
                    <RotateCw aria-hidden />
                    Make a new {view.provider === 'whatsapp_cloud' ? 'verify token' : view.provider === 'indiamart' ? 'push key' : 'callback token'}
                  </Button>
                </div>
              </section>
            )}
            <ConfirmDialog
              open={confirmToken}
              onOpenChange={setConfirmToken}
              title="Replace the token?"
              description={`The current ${view.provider === 'indiamart' ? 'push URL' : 'token'} stops working at once. Paste the new one on the ${view.name} side right after.`}
              confirmLabel="Make a new one"
              loading={m.rotateToken.isPending}
              onConfirm={() =>
                m.rotateToken.mutate(view.provider, {
                  onSuccess: () => {
                    setConfirmToken(false);
                    toast.success('New token ready. Copy it to the provider.');
                  },
                  onError: (err) => toast.error(formErrorMessage(err)),
                })
              }
            />

            {formError && <InlineAlert title="Not connected">{formError}</InlineAlert>}

            {oauth && !view.configured ? (
              <div className="flex flex-col items-start gap-2">
                <Button variant="primary" onClick={() => void startOauth()} loading={m.oauthStart.isPending} disabled={!!blocked}>
                  <ExternalLink aria-hidden />
                  Connect with Google
                </Button>
                <p className="text-xs text-muted">Google asks you to allow access, then sends you back here.</p>
              </div>
            ) : (
              <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
                <h3 className="text-sm font-semibold text-fg">{live ? 'Connection details' : 'Settings'}</h3>
                {!live && <p className="text-sm text-fg-secondary">Test mode needs no keys. Vistar fakes the provider&apos;s answers; nothing reaches a real account.</p>}
                {fields
                  .filter((f) => live || !f.secret)
                  .map((f) => (
                    <FieldControl
                      key={f.key}
                      field={f}
                      value={values[f.key]}
                      error={errors[f.key]}
                      secretValue={secrets[f.key] ?? ''}
                      storedHint={hasStored(f) ? (row.secretHints[f.key] ?? null) : null}
                      onChange={(v) => set(f.key, v)}
                      onSecretChange={(v) => {
                        setSecrets((p) => ({ ...p, [f.key]: v }));
                        setErrors((p) => ({ ...p, [f.key]: '' }));
                      }}
                      onReplace={() => setReplacing((p) => ({ ...p, [f.key]: true }))}
                      disabled={!!reason}
                    />
                  ))}
              </form>
            )}

            {info?.capabilities.test && view.configured && (
              <section aria-labelledby={`${formId}-test`} className="flex flex-col items-start gap-2 border-t border-border pt-4">
                <h3 id={`${formId}-test`} className="text-sm font-semibold text-fg">
                  Test the connection
                </h3>
                {view.provider === 'smtp' && (
                  <FormField label="Send the test email to" className="w-full">
                    <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                  </FormField>
                )}
                <Button onClick={() => void runTest()} loading={m.test.isPending} disabled={!!reason}>
                  <FlaskConical aria-hidden />
                  {view.provider === 'smtp' ? 'Send test email' : 'Test connection'}
                </Button>
                <div aria-live="polite">
                  {outcome && (
                    <p className={outcome.ok ? 'flex items-center gap-1.5 text-sm text-success-text' : 'flex items-center gap-1.5 text-sm text-danger-text'}>
                      {outcome.ok ? <CheckCircle2 aria-hidden className="size-4 shrink-0" /> : <XCircle aria-hidden className="size-4 shrink-0" />}
                      {outcome.message}
                      {outcome.latencyMs !== null && <span className="text-muted-strong">({outcome.latencyMs} ms)</span>}
                    </p>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
          {blocked && <p className="mr-auto text-xs text-muted-strong">{reason ?? 'Connecting is not possible right now.'}</p>}
          <SheetClose asChild>
            <Button disabled={m.connect.isPending} className="h-11 sm:h-8">
              {oauth && !view.configured ? 'Close' : 'Cancel'}
            </Button>
          </SheetClose>
          {!(oauth && !view.configured) && (
            <Button type="submit" form={formId} variant="primary" loading={m.connect.isPending} disabled={!!blocked} className="h-11 sm:h-8">
              {view.configured ? 'Save and test' : 'Save and connect'}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FieldControl({
  field: f,
  value,
  error,
  secretValue,
  storedHint,
  onChange,
  onSecretChange,
  onReplace,
  disabled,
}: {
  field: IntegrationField;
  value: FieldValue | undefined;
  error?: string;
  secretValue: string;
  storedHint: string | null;
  onChange: (v: FieldValue) => void;
  onSecretChange: (v: string) => void;
  onReplace: () => void;
  disabled: boolean;
}) {
  const hint = f.help ?? undefined;
  if (f.type === 'boolean') return <CheckboxRow checked={value === true} onCheckedChange={onChange} label={f.label} hint={hint} disabled={disabled} />;
  if (f.secret && storedHint)
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-fg-secondary">{f.label}</p>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 text-sm text-fg-secondary" data-testid={`secret-hint-${f.key}`}>
            <KeyRound aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">
              Saved <span className="font-mono">{storedHint}</span>. Hidden for security.
            </span>
          </span>
          <Button size="sm" onClick={onReplace} disabled={disabled} aria-label={`Replace the ${f.label.toLowerCase()}`}>
            Replace
          </Button>
        </div>
      </div>
    );
  if (f.secret)
    return (
      <FormField label={f.label} hint={hint ?? 'Stored encrypted. It is never shown again after you save.'} error={error || undefined} required={f.required}>
        <Input type="password" autoComplete="new-password" spellCheck={false} value={secretValue} onChange={(e) => onSecretChange(e.target.value)} disabled={disabled} placeholder={f.placeholder ?? undefined} />
      </FormField>
    );
  if (f.type === 'select')
    return (
      <FormField label={f.label} hint={hint} error={error || undefined} required={f.required}>
        <NativeSelect value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </FormField>
    );
  if (f.type === 'tags')
    return (
      <FormField label={f.label} hint={hint ?? 'Separate with commas.'} error={error || undefined} required={f.required}>
        <Input
          value={Array.isArray(value) ? value.join(', ') : ''}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(',')
                .map((s) => s.trimStart())
                .filter((s, i, all) => s !== '' || i === all.length - 1),
            )
          }
          onBlur={(e) => onChange(e.target.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))}
          disabled={disabled}
          placeholder={f.placeholder ?? 'indiamart, trade-fair'}
        />
      </FormField>
    );
  return (
    <FormField label={f.label} hint={hint} error={error || undefined} required={f.required}>
      <Input
        type={f.type === 'email' ? 'email' : 'text'}
        inputMode={f.type === 'number' ? 'numeric' : undefined}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(f.type === 'number' ? e.target.value.replace(/[^\d]/g, '') : e.target.value)}
        placeholder={f.placeholder ?? undefined}
        disabled={disabled}
        spellCheck={false}
      />
    </FormField>
  );
}
