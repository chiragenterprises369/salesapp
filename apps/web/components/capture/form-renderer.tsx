'use client';

import { normalizeIndianPhone, type CaptureField } from '@vistar/shared';
import { CheckCircle2 } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Checkbox } from '@/components/leads/primitives/checkbox';
import { Button } from '@/components/ui/button';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/cn';

export type RenderField = Omit<CaptureField, 'mapTo'> & { mapTo?: CaptureField['mapTo'] };
export type FormValue = string | number | boolean | string[] | null;

export interface RenderableForm {
  name: string;
  fields: readonly RenderField[];
  submitLabel: string;
  successMessage: string;
  consent: { enabled: boolean; required: boolean; text: string };
  layout: 'card' | 'plain';
  showLogo: boolean;
  honeypotField: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Client-side checks that mirror the API (required, email, phone, number). */
export function validateAnswers(fields: readonly RenderField[], values: Record<string, FormValue>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (f.type === 'hidden') continue;
    const v = values[f.id];
    const empty = v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0);
    if (f.required && empty) {
      errors[f.id] = f.type === 'checkbox' ? 'Tick this box to continue.' : `Enter ${f.label.toLowerCase()}.`;
      continue;
    }
    if (empty) continue;
    if (f.type === 'email' && typeof v === 'string' && !EMAIL_RE.test(v.trim())) errors[f.id] = 'Enter an email like name@company.com.';
    if (f.type === 'phone' && typeof v === 'string' && !(normalizeIndianPhone(v) || /^\+[1-9]\d{6,14}$/.test(v.trim()))) errors[f.id] = 'Enter a 10-digit mobile number.';
    if (f.type === 'number' && typeof v === 'string' && !/^-?\d+(\.\d+)?$/.test(v.trim())) errors[f.id] = 'Enter a number.';
  }
  return errors;
}

/** Answers as the submit route expects them (phones normalised, numbers as numbers, trimmed text). */
export function normaliseAnswers(fields: readonly RenderField[], values: Record<string, FormValue>): Record<string, FormValue> {
  const out: Record<string, FormValue> = {};
  for (const f of fields) {
    const v = values[f.id];
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (f.type === 'phone' && typeof v === 'string') out[f.id] = normalizeIndianPhone(v) ?? v.trim();
    else if (f.type === 'number' && typeof v === 'string') out[f.id] = Number(v);
    else if (typeof v === 'string') out[f.id] = v.trim();
    else out[f.id] = v;
  }
  return out;
}

/**
 * Renders a lead capture form: the builder preview and the hosted page share this component, so what
 * the admin sees is what visitors get. The honeypot input sits off-screen (not display:none) so bots
 * fill it and people never see it; screen readers skip it (aria-hidden, tabIndex -1).
 */
export function CaptureFormRenderer({
  form,
  logoUrl,
  workspaceName,
  preview,
  initialValues = {},
  onSubmit,
}: {
  form: RenderableForm;
  logoUrl?: string | null;
  workspaceName: string;
  preview?: boolean;
  initialValues?: Record<string, FormValue>;
  onSubmit?: (payload: { values: Record<string, FormValue>; consent?: boolean; hp: string }) => Promise<{ message: string; redirectUrl: string | null }>;
}) {
  const base = useId().replace(/:/g, '');
  const [values, setValues] = useState<Record<string, FormValue>>(() => {
    const v: Record<string, FormValue> = {};
    for (const f of form.fields) v[f.id] = initialValues[f.id] ?? (f.type === 'checkbox' ? false : f.type === 'multi_select' ? [] : (f.defaultValue ?? ''));
    return v;
  });
  const [consent, setConsent] = useState(false);
  const [hp, setHp] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const set = (id: string, v: FormValue) => {
    setValues((s) => ({ ...s, [id]: v }));
    if (errors[id]) setErrors(({ [id]: _gone, ...rest }) => rest);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (preview || !onSubmit) return;
    const errs = validateAnswers(form.fields, values);
    if (form.consent.enabled && form.consent.required && !consent) errs.__consent = 'Tick the box to agree before sending.';
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError(Object.keys(errs).length === 1 ? 'Check the highlighted field.' : `Check the ${Object.keys(errs).length} highlighted fields.`);
      requestAnimationFrame(() => document.getElementById(base)?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const r = await onSubmit({ values: normaliseAnswers(form.fields, values), consent: form.consent.enabled ? consent : undefined, hp });
      if (r.redirectUrl) window.location.assign(r.redirectUrl);
      else setDone(r.message || form.successMessage);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Your answers were not sent. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const shell = cn('w-full', form.layout === 'card' && 'rounded-lg border border-border bg-surface p-6 shadow-card sm:p-8');

  if (done) {
    return (
      <div className={shell} role="status">
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 aria-hidden className="size-10 text-success-text" />
          <p className="text-base font-semibold text-fg">{done}</p>
        </div>
      </div>
    );
  }

  return (
    <form id={base} noValidate onSubmit={(e) => void submit(e)} className={shell} aria-label={form.name}>
      {form.showLogo && (
        <div className="mb-5 flex items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- workspace logo from storage
            <img src={logoUrl} alt={workspaceName} className="h-9 w-auto max-w-40 object-contain" />
          ) : (
            <span className="text-sm font-semibold text-fg">{workspaceName}</span>
          )}
        </div>
      )}
      <h1 className="mb-4 text-lg font-semibold text-fg">{form.name}</h1>
      {formError && (
        <p role="alert" className="mb-4 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-sm text-status-red-fg">
          {formError}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {form.fields.map((f) => {
          if (f.type === 'hidden') return null;
          const wide = f.type === 'textarea' || f.type === 'multi_select' || f.type === 'checkbox';
          const v = values[f.id];
          if (f.type === 'checkbox') {
            return (
              <div key={f.id} className="flex flex-col gap-1 sm:col-span-2">
                <div className="flex items-start gap-2">
                  <Checkbox id={`${base}-${f.id}`} className="mt-0.5" checked={v === true} aria-invalid={errors[f.id] ? true : undefined} aria-describedby={errors[f.id] ? `${base}-${f.id}-err` : undefined} onCheckedChange={(c) => set(f.id, c === true)} />
                  <label htmlFor={`${base}-${f.id}`} className="text-sm text-fg">
                    {f.label}
                    {f.required && <span className="text-danger-text"> *</span>}
                  </label>
                </div>
                {errors[f.id] && (
                  <p id={`${base}-${f.id}-err`} role="alert" className="text-xs text-danger-text">
                    {errors[f.id]}
                  </p>
                )}
              </div>
            );
          }
          if (f.type === 'multi_select') {
            const list = Array.isArray(v) ? v : [];
            return (
              <fieldset key={f.id} className="flex flex-col gap-1.5 sm:col-span-2" aria-invalid={errors[f.id] ? true : undefined}>
                <legend className="mb-1 text-xs font-medium text-fg-secondary">
                  {f.label}
                  {f.required && <span className="text-danger-text"> *</span>}
                </legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {f.options.map((o) => (
                    <label key={o.value} className="flex items-center gap-1.5 text-sm text-fg">
                      <Checkbox checked={list.includes(o.value)} onCheckedChange={(c) => set(f.id, c === true ? [...list, o.value] : list.filter((x) => x !== o.value))} />
                      {o.label}
                    </label>
                  ))}
                </div>
                {f.helpText && <p className="text-xs text-muted-strong">{f.helpText}</p>}
                {errors[f.id] && (
                  <p role="alert" className="text-xs text-danger-text">
                    {errors[f.id]}
                  </p>
                )}
              </fieldset>
            );
          }
          return (
            <FormField key={f.id} label={f.label} required={f.required} hint={f.helpText ?? undefined} error={errors[f.id]} className={cn(wide && 'sm:col-span-2')}>
              {f.type === 'textarea' ? (
                <Textarea rows={4} name={f.id} placeholder={f.placeholder ?? undefined} value={String(v ?? '')} onChange={(e) => set(f.id, e.target.value)} />
              ) : f.type === 'select' ? (
                <NativeSelect name={f.id} value={String(v ?? '')} onChange={(e) => set(f.id, e.target.value)}>
                  <option value="">{f.placeholder ?? 'Choose'}</option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <Input
                  name={f.id}
                  type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'date' ? 'date' : 'text'}
                  inputMode={f.type === 'number' ? 'decimal' : f.type === 'phone' ? 'tel' : f.type === 'email' ? 'email' : undefined}
                  autoComplete={f.mapTo === 'name' || f.id === 'name' ? 'name' : f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.mapTo === 'city' ? 'address-level2' : f.mapTo === 'companyName' ? 'organization' : undefined}
                  placeholder={f.placeholder ?? undefined}
                  value={String(v ?? '')}
                  onChange={(e) => set(f.id, e.target.value)}
                />
              )}
            </FormField>
          );
        })}
      </div>
      {/* Honeypot: off-screen, not display:none, hidden from assistive tech. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
        <label htmlFor={`${base}-hp`}>Leave this empty</label>
        <input id={`${base}-hp`} name={form.honeypotField} type="text" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
      </div>
      {form.consent.enabled && (
        <div className="mt-4 flex flex-col gap-1">
          <div className="flex items-start gap-2">
            <Checkbox id={`${base}-consent`} className="mt-0.5" checked={consent} aria-invalid={errors.__consent ? true : undefined} aria-describedby={errors.__consent ? `${base}-consent-err` : undefined} onCheckedChange={(c) => setConsent(c === true)} />
            <label htmlFor={`${base}-consent`} className="text-sm text-fg-secondary">
              {form.consent.text}
              {form.consent.required && <span className="text-danger-text"> *</span>}
            </label>
          </div>
          {errors.__consent && (
            <p id={`${base}-consent-err`} role="alert" className="text-xs text-danger-text">
              {errors.__consent}
            </p>
          )}
        </div>
      )}
      <Button type="submit" variant="primary" className="mt-5 h-11 w-full sm:w-auto" loading={submitting} aria-disabled={preview || undefined}>
        {form.submitLabel}
      </Button>
      {preview && <p className="mt-2 text-xs text-muted-strong">Preview: submitting is off here.</p>}
    </form>
  );
}
