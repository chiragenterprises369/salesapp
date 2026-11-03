'use client';

import { CheckCircle2, ExternalLink, FlaskConical, KeyRound, X, XCircle } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/leads/primitives/sheet';
import { CheckboxRow } from '@/components/settings/common/checkbox';
import { InlineAlert } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { formErrorMessage, serverFieldErrors } from '@/lib/crm/ui/errors';
import { useIntegrationMutations } from '@/lib/hub/integrations';
import { CopyField } from '@/lib/hub/ui/copy';
import { fieldDefault, visibleFields, type ProviderField } from './providers';
import type { IntegrationView } from './view';

type Values = Record<string, string | boolean>;

function initialValues(view: IntegrationView): Values {
  const out: Values = {};
  for (const f of view.meta.fields) {
    if (f.secret) continue;
    const saved = view.config[f.key];
    if (typeof saved === 'string' || typeof saved === 'boolean') out[f.key] = saved;
    else if (typeof saved === 'number') out[f.key] = String(saved);
    else {
      const d = fieldDefault(f);
      if (d !== undefined) out[f.key] = d;
    }
  }
  return out;
}

/** Form value -> config value (numbers as numbers, booleans as booleans, empty strings dropped). */
function configValue(f: ProviderField, v: string | boolean | undefined): unknown {
  if (f.type === 'boolean') return v === true;
  if (v === undefined || v === '') return undefined;
  if (f.type === 'number') return Number(v);
  return typeof v === 'string' ? v.trim() : v;
}

interface TestOutcome {
  ok: boolean;
  message: string;
  latencyMs: number | null;
}

/**
 * Connect or update one provider: setup steps, the provider's fields (secret fields are write-only:
 * after saving they show only that a value is stored, with Replace), copyable URLs and tokens for
 * the provider's side, and a connection test.
 */
export function ConnectSheet({ view, onClose }: { view: IntegrationView; onClose: () => void }) {
  const formId = useId().replace(/:/g, '');
  const m = useIntegrationMutations();
  const { reason } = useReadOnly();
  const [values, setValues] = useState<Values>(() => initialValues(view));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [test, setTest] = useState<TestOutcome | null>(null);
  const [current, setCurrent] = useState(view);

  const fields = visibleFields(view.meta.fields, values);
  const stored = (f: ProviderField) => f.secret && current.hasSecrets && !replacing[f.key];
  const set = (key: string, v: string | boolean) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((prev) => ({ ...prev, [key]: '' }));
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    for (const f of fields) {
      if (f.secret) {
        if (f.required && !stored(f) && !secrets[f.key]?.trim()) next[f.key] = `Enter the ${f.label.toLowerCase()}.`;
        continue;
      }
      const v = values[f.key];
      if (f.required && (v === undefined || v === '')) next[f.key] = `Enter the ${f.label.toLowerCase()}.`;
      else if (f.type === 'number' && typeof v === 'string' && v && !/^\d+$/.test(v)) next[f.key] = 'Enter a whole number.';
      else if (f.type === 'email' && typeof v === 'string' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) next[f.key] = 'Enter an email address like sales@yourcompany.in.';
      else if (f.type === 'url' && typeof v === 'string' && v && !/^https?:\/\//.test(v)) next[f.key] = 'Enter a full address starting with https://.';
    }
    setErrors(next);
    return !Object.values(next).some(Boolean);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;
    const config: Record<string, unknown> = {};
    for (const f of fields) if (!f.secret) {
      const v = configValue(f, values[f.key]);
      if (v !== undefined) config[f.key] = v;
    }
    const secretBody: Record<string, string> = {};
    for (const f of fields) if (f.secret && secrets[f.key]?.trim()) secretBody[f.key] = secrets[f.key]!.trim();
    try {
      const saved = await m.connect.mutateAsync({ provider: view.provider, body: { config, secrets: secretBody } });
      setSecrets({});
      setReplacing({});
      setCurrent({ ...current, hasSecrets: saved.hasSecrets, status: saved.status, lastError: saved.lastError, config: saved.config, configured: saved.status !== 'disconnected' && saved.status !== 'not_connected' });
      if (saved.status === 'connected') {
        toast.success(`${view.meta.name} connected`);
        onClose();
      } else {
        setFormError(saved.lastError ?? `${view.meta.name} is saved but not connected yet. Check the details and test again.`);
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
    setTest(null);
    try {
      const r = await m.test.mutateAsync(view.provider);
      setTest(r);
    } catch (err) {
      setTest({ ok: false, message: formErrorMessage(err, 'The test did not run. Try again.'), latencyMs: null });
    }
  };

  const oauth = !!view.meta.oauth;
  const connectOauth = async () => {
    setFormError(null);
    try {
      const saved = await m.connect.mutateAsync({ provider: view.provider, body: { config: { returnUrl: window.location.href }, secrets: {} } });
      const url = typeof saved.config.authUrl === 'string' ? saved.config.authUrl : null;
      if (url && /^https:\/\//.test(url)) window.location.assign(url);
      else if (saved.status === 'connected') {
        toast.success(`${view.meta.name} connected`);
        onClose();
      } else setFormError(saved.lastError ?? `${view.meta.name} is not available on this Vistar server yet.`);
    } catch (err) {
      setFormError(formErrorMessage(err));
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg" aria-describedby={`${formId}-desc`}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <SheetTitle className="text-base font-semibold text-fg">{view.configured ? `${view.meta.name} settings` : `Connect ${view.meta.name}`}</SheetTitle>
            <SheetDescription id={`${formId}-desc`} className="mt-0.5 text-sm text-muted-strong">
              {view.meta.description}
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
            {view.notConfiguredReason && <InlineAlert tone="info">{view.notConfiguredReason}</InlineAlert>}
            {view.meta.setupSteps.length > 0 && (
              <section aria-labelledby={`${formId}-steps`}>
                <h3 id={`${formId}-steps`} className="mb-2 text-sm font-semibold text-fg">
                  How to set it up
                </h3>
                <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-fg-secondary marker:text-muted-strong">
                  {view.meta.setupSteps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </section>
            )}

            {current.copyables.length > 0 && (
              <section aria-labelledby={`${formId}-copy`} className="flex flex-col gap-3">
                <h3 id={`${formId}-copy`} className="text-sm font-semibold text-fg">
                  For the {view.meta.name} side
                </h3>
                {current.copyables.map((c) => (
                  <CopyField key={c.key} label={c.label} value={c.value} what={c.label} hint={c.hint} testId={`copy-${c.key}`} />
                ))}
              </section>
            )}

            {formError && <InlineAlert title="Not connected">{formError}</InlineAlert>}

            {oauth ? (
              <div className="flex flex-col items-start gap-2">
                <Button variant="primary" onClick={() => void connectOauth()} loading={m.connect.isPending} disabled={!!reason}>
                  <ExternalLink aria-hidden />
                  Connect with Google
                </Button>
                <p className="text-xs text-muted">You will come back here after Google asks you to allow access.</p>
              </div>
            ) : (
              <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
                <h3 className="text-sm font-semibold text-fg">Connection details</h3>
                {fields.map((f) => (
                  <FieldControl
                    key={f.key}
                    field={f}
                    value={values[f.key]}
                    error={errors[f.key]}
                    secretValue={secrets[f.key] ?? ''}
                    storedPreview={stored(f) ? (current.secretPreviews[f.key] ?? 'saved') : null}
                    onChange={(v) => set(f.key, v)}
                    onSecretChange={(v) => {
                      setSecrets((p) => ({ ...p, [f.key]: v }));
                      setErrors((p) => ({ ...p, [f.key]: '' }));
                    }}
                    onReplace={() => setReplacing((p) => ({ ...p, [f.key]: true }))}
                    disabled={!!reason}
                  />
                ))}
                {fields.length === 0 && <p className="text-sm text-muted-strong">Nothing to fill in for this provider.</p>}
              </form>
            )}

            {view.meta.canTest && current.configured && (
              <section aria-live="polite" className="flex flex-col items-start gap-2">
                <Button onClick={() => void runTest()} loading={m.test.isPending} disabled={!!reason}>
                  <FlaskConical aria-hidden />
                  Test connection
                </Button>
                {test && (
                  <p className={test.ok ? 'flex items-center gap-1.5 text-sm text-success-text' : 'flex items-center gap-1.5 text-sm text-danger-text'} role={test.ok ? undefined : 'alert'}>
                    {test.ok ? <CheckCircle2 aria-hidden className="size-4" /> : <XCircle aria-hidden className="size-4" />}
                    {test.message}
                    {test.latencyMs !== null && <span className="text-muted-strong">({test.latencyMs} ms)</span>}
                  </p>
                )}
              </section>
            )}
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
          {reason && <p className="mr-auto text-xs text-muted-strong">{reason}</p>}
          <SheetClose asChild>
            <Button disabled={m.connect.isPending} className="h-11 sm:h-8">
              {oauth ? 'Close' : 'Cancel'}
            </Button>
          </SheetClose>
          {!oauth && (
            <Button type="submit" form={formId} variant="primary" loading={m.connect.isPending} disabled={!!reason} className="h-11 sm:h-8">
              {view.configured ? 'Save changes' : 'Save and connect'}
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
  storedPreview,
  onChange,
  onSecretChange,
  onReplace,
  disabled,
}: {
  field: ProviderField;
  value: string | boolean | undefined;
  error?: string;
  secretValue: string;
  storedPreview: string | null;
  onChange: (v: string | boolean) => void;
  onSecretChange: (v: string) => void;
  onReplace: () => void;
  disabled: boolean;
}) {
  if (f.type === 'boolean') return <CheckboxRow checked={value === true} onCheckedChange={onChange} label={f.label} hint={f.hint} disabled={disabled} />;
  if (f.secret && storedPreview)
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-fg-secondary">{f.label}</p>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 text-sm text-fg-secondary">
            <KeyRound aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">Saved{storedPreview !== 'saved' ? ` (${storedPreview})` : ''}. Hidden for security.</span>
          </span>
          <Button size="sm" onClick={onReplace} disabled={disabled} aria-label={`Replace the ${f.label.toLowerCase()}`}>
            Replace
          </Button>
        </div>
      </div>
    );
  if (f.secret)
    return (
      <FormField label={f.label} hint={f.hint ?? 'Stored encrypted. It is never shown again after you save.'} error={error || undefined} required={f.required}>
        <Input type="password" autoComplete="new-password" spellCheck={false} value={secretValue} onChange={(e) => onSecretChange(e.target.value)} disabled={disabled} placeholder={f.placeholder} />
      </FormField>
    );
  if (f.type === 'select')
    return (
      <FormField label={f.label} hint={f.hint} error={error || undefined} required={f.required}>
        <NativeSelect value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </FormField>
    );
  return (
    <FormField label={f.label} hint={f.hint} error={error || undefined} required={f.required}>
      <Input
        type={f.type === 'number' ? 'text' : f.type === 'password' ? 'password' : f.type}
        inputMode={f.type === 'number' ? 'numeric' : undefined}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={f.placeholder}
        disabled={disabled}
        spellCheck={false}
      />
    </FormField>
  );
}
