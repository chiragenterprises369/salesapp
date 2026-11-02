'use client';

import { CAPTURE_FIELD_TYPES, CAPTURE_HONEYPOT_FIELD, LEAD_FORM_TARGETS, type CaptureFieldType, type CaptureForm } from '@vistar/shared';
import { ArrowDown, ArrowUp, Code, Copy, ExternalLink, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { NativeSelect } from '@/components/common/native-select';
import { Switch } from '@/components/common/switch';
import { useNow } from '@/components/common/use-now';
import { Segmented } from '@/components/dashboard/segmented';
import { Checkbox } from '@/components/leads/primitives/checkbox';
import { settingsChild } from '@/components/settings/settings-layout';
import { SettingsCard } from '@/components/settings/settings-card';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useCaptureForm, useCaptureMutations, useCaptureSubmissions } from '@/lib/crm/automation';
import { ago } from '@/lib/crm/format';
import { useDefaultPipeline, useVisibleFields } from '@/lib/customization/hooks';
import { ConfirmDialog } from '@/lib/crm/ui/confirm-dialog';
import { DetailError, DetailHeader } from '@/lib/crm/ui/detail-layout';
import { formErrorMessage, serverFieldErrors } from '@/lib/crm/ui/errors';
import { FormGrid, OwnerSelect, TagsInput } from '@/lib/crm/ui/fields';
import { useMe } from '@/lib/session/session';
import { copyText } from './capture-forms-list';
import { CaptureFormRenderer, type RenderField } from './form-renderer';

const TYPE_LABEL: Record<CaptureFieldType, string> = {
  text: 'Short text',
  email: 'Email',
  phone: 'Phone',
  textarea: 'Long text',
  number: 'Number',
  select: 'Dropdown',
  multi_select: 'Multiple choice',
  checkbox: 'Checkbox',
  date: 'Date',
  hidden: 'Hidden (from the page URL)',
};

const TARGET_LABEL: Record<(typeof LEAD_FORM_TARGETS)[number], string> = {
  name: 'Lead name',
  phone: 'Phone',
  email: 'Email',
  companyName: 'Company name',
  city: 'City',
  state: 'State',
  productInterest: 'Product interest',
  requirement: 'Requirement',
  valueInr: 'Value (₹)',
  tags: 'Tags',
};

interface FieldDraft extends RenderField {
  key: string;
}

let seq = 0;
const k = () => `f${Date.now().toString(36)}${(seq++).toString(36)}`;
const field = (patch: Partial<FieldDraft> & Pick<FieldDraft, 'id' | 'label' | 'type'>): FieldDraft => ({ key: k(), required: false, placeholder: null, helpText: null, options: [], mapTo: null, param: null, defaultValue: null, ...patch });

const DEFAULT_FIELDS = (): FieldDraft[] => [
  field({ id: 'name', label: 'Your name', type: 'text', required: true, mapTo: 'name' }),
  field({ id: 'phone', label: 'Mobile number', type: 'phone', required: true, mapTo: 'phone' }),
  field({ id: 'email', label: 'Email', type: 'email', mapTo: 'email' }),
  field({ id: 'city', label: 'City', type: 'text', mapTo: 'city' }),
  field({ id: 'requirement', label: 'What do you need?', type: 'textarea', mapTo: 'requirement' }),
];

const slug = (s: string) => {
  const v = s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return /^[a-z]/.test(v) ? v : `f_${v}`.slice(0, 40);
};

interface SettingsDraft {
  submitLabel: string;
  successMessage: string;
  redirectUrl: string;
  consentEnabled: boolean;
  consentRequired: boolean;
  consentText: string;
  defaultTags: string[];
  ownerId: string | null;
  stageId: string | null;
  notifyOwner: boolean;
  dedupe: 'none' | 'phone_or_email';
  layout: 'card' | 'plain';
  showLogo: boolean;
}

const settingsFrom = (f?: CaptureForm): SettingsDraft => ({
  submitLabel: f?.settings.submitLabel ?? 'Send enquiry',
  successMessage: f?.settings.successMessage ?? 'Thank you. We will contact you shortly.',
  redirectUrl: f?.settings.redirectUrl ?? '',
  consentEnabled: f?.settings.consent.enabled ?? true,
  consentRequired: f?.settings.consent.required ?? false,
  consentText: f?.settings.consent.text ?? 'I agree to be contacted on phone, WhatsApp and email about my enquiry.',
  defaultTags: f?.settings.defaultTags ?? [],
  ownerId: f?.settings.ownerId ?? null,
  stageId: f?.settings.stageId ?? null,
  notifyOwner: f?.settings.notifyOwner ?? true,
  dedupe: f?.settings.dedupe ?? 'phone_or_email',
  layout: f?.settings.layout ?? 'card',
  showLogo: f?.settings.showLogo ?? true,
});

/** Same rules as the API (unique keys, options for choices, one field for the name and one for phone or email, each lead field once). */
export function builderProblems(fields: readonly FieldDraft[]): Record<string, string> {
  const e: Record<string, string> = {};
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(f.id)) e[`fields.${i}.id`] = 'Keys start with a letter and use a-z, 0-9 and _.';
    else if (seen.has(f.id)) e[`fields.${i}.id`] = 'Field keys must be unique.';
    seen.add(f.id);
    if (!f.label.trim()) e[`fields.${i}.label`] = 'Enter a label.';
    if ((f.type === 'select' || f.type === 'multi_select') && !f.options.length) e[`fields.${i}.options`] = 'Add at least one option.';
  });
  const targets = fields.map((f) => f.mapTo).filter((t): t is string => !!t);
  if (!targets.includes('name')) e.fields = 'Map one field to the lead name.';
  else if (!targets.includes('phone') && !targets.includes('email')) e.fields = 'Map one field to the phone or the email.';
  const mapped = targets.filter((t) => t !== 'tags');
  if (new Set(mapped).size !== mapped.length) e.fields = 'Each lead field can be mapped once.';
  if (fields.length > 40) e.fields = 'A form has at most 40 fields.';
  return e;
}

export function CaptureFormBuilderPage({ id }: { id: string }) {
  const item = settingsChild('settings-lead-capture');
  return (
    <RequirePermission anyOf={item.anyOf ?? []}>
      {id === 'new' ? <Builder /> : <ExistingBuilder id={id} />}
    </RequirePermission>
  );
}

function ExistingBuilder({ id }: { id: string }) {
  const q = useCaptureForm(id);
  if (q.isPending) return <Skeleton className="h-96 w-full rounded-lg" />;
  if (q.isError) return <DetailError error={q.error} onRetry={() => void q.refetch()} backHref="/app/settings/lead-capture" backLabel="Back to forms" noun="form" />;
  return <Builder form={q.data} key={q.data.updatedAt} />;
}

function Builder({ form }: { form?: CaptureForm }) {
  const router = useRouter();
  const me = useMe();
  const m = useCaptureMutations();
  const leadFields = useVisibleFields('lead');
  const pipeline = useDefaultPipeline();
  const [name, setName] = useState(form?.name ?? 'Enquiry form');
  const [active, setActive] = useState(form ? form.status === 'active' : true);
  const [fields, setFields] = useState<FieldDraft[]>(() => (form ? form.fields.map((f) => ({ ...f, key: k() })) : DEFAULT_FIELDS()));
  const [settings, setSettings] = useState<SettingsDraft>(() => settingsFrom(form));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [tab, setTab] = useState<'build' | 'submissions'>('build');
  const [deleting, setDeleting] = useState(false);
  const setS = (patch: Partial<SettingsDraft>) => setSettings((s) => ({ ...s, ...patch }));
  const setF = (i: number, patch: Partial<FieldDraft>) => setFields((list) => list.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, dir: -1 | 1) => setFields((list) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  });

  const targets = useMemo(() => [...LEAD_FORM_TARGETS.map((t) => ({ value: t, label: TARGET_LABEL[t] })), ...(leadFields.data ?? []).map((d) => ({ value: `custom.${d.key}`, label: `Custom: ${d.label}` }))], [leadFields.data]);
  const used = new Set(fields.map((f) => f.mapTo).filter(Boolean));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const errs = builderProblems(fields);
    if (!name.trim()) errs.name = 'Enter a form name.';
    if (settings.redirectUrl.trim() && !/^https?:\/\/\S+\.\S+/.test(settings.redirectUrl.trim())) errs.redirectUrl = 'Enter a link that starts with https://';
    if (!settings.submitLabel.trim()) errs.submitLabel = 'Enter the button text.';
    if (!settings.successMessage.trim()) errs.successMessage = 'Enter the thank-you message.';
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError(Object.keys(errs).length === 1 ? (errs.fields ?? 'Fix the highlighted field to save.') : `Fix the ${Object.keys(errs).length} problems to save.`);
      return;
    }
    const payloadFields = fields.map(({ key: _key, ...f }) => ({ ...f, label: f.label.trim(), options: f.type === 'select' || f.type === 'multi_select' ? f.options : [], param: f.type === 'hidden' ? f.param : null }));
    const payloadSettings = {
      submitLabel: settings.submitLabel.trim(),
      successMessage: settings.successMessage.trim(),
      redirectUrl: settings.redirectUrl.trim() || null,
      consent: { enabled: settings.consentEnabled, required: settings.consentEnabled && settings.consentRequired, text: settings.consentText.trim() },
      defaultTags: settings.defaultTags,
      ownerId: settings.ownerId,
      stageId: settings.stageId,
      notifyOwner: settings.notifyOwner,
      dedupe: settings.dedupe,
      layout: settings.layout,
      showLogo: settings.showLogo,
    };
    try {
      if (form) {
        await m.update.mutateAsync({ id: form.id, patch: { name: name.trim(), status: active ? 'active' : 'paused', fields: payloadFields, settings: payloadSettings } });
        toast.success('Form saved. The hosted page and embeds show the new version now.');
      } else {
        const created = await m.create.mutateAsync({ name: name.trim(), status: active ? 'active' : 'paused', fields: payloadFields, settings: payloadSettings });
        toast.success('Form created. Copy the link or the embed snippet to start collecting leads.');
        router.replace(`/app/settings/lead-capture/${created.id}`);
      }
      setFormError(null);
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFormError(formErrorMessage(err));
    }
  };

  const previewForm = {
    name: name || 'Form',
    fields,
    submitLabel: settings.submitLabel || 'Submit',
    successMessage: settings.successMessage,
    consent: { enabled: settings.consentEnabled, required: settings.consentRequired, text: settings.consentText },
    layout: settings.layout,
    showLogo: settings.showLogo,
    honeypotField: CAPTURE_HONEYPOT_FIELD,
  };
  const previewKey = fields.map((f) => `${f.key}:${f.type}:${f.defaultValue ?? ''}`).join('|');

  return (
    <div className="flex w-full min-w-0 flex-col pb-6">
      <DetailHeader
        backHref="/app/settings/lead-capture"
        backLabel="Lead capture forms"
        title={form ? form.name : 'New capture form'}
        subtitle={form ? `${form.submissionCount} submissions` : 'Fields on the left, live preview on the right.'}
        meta={form && (form.status === 'active' ? <Chip tone="green">Live</Chip> : <Chip tone="grey">Paused</Chip>)}
        actions={
          <>
            {form && (
              <Button variant="ghost" className="text-danger-text" onClick={() => setDeleting(true)}>
                <Trash2 aria-hidden />
                Delete
              </Button>
            )}
            {tab === 'build' && (
              <Button type="submit" form="capture-builder" variant="primary" loading={m.create.isPending || m.update.isPending}>
                {form ? 'Save form' : 'Create form'}
              </Button>
            )}
          </>
        }
      />
      {form && (
        <Segmented
          className="mb-3 self-start"
          label="Section"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'build', label: 'Form' },
            { value: 'submissions', label: 'Submissions' },
          ]}
        />
      )}
      {tab === 'submissions' && form ? (
        <Submissions form={form} />
      ) : (
        <form id="capture-builder" noValidate onSubmit={(e) => void save(e)} className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
          <div className="flex min-w-0 flex-col gap-4">
            {formError && (
              <p role="alert" className="rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-sm text-status-red-fg">
                {formError}
              </p>
            )}
            <SettingsCard title="Form">
              <FormGrid>
                <FormField label="Form name" required error={errors.name} hint="Visitors see it as the form title">
                  <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
                </FormField>
                <label className="flex items-center gap-3 self-end pb-1.5 text-sm text-fg">
                  <Switch checked={active} onCheckedChange={setActive} />
                  Live (paused forms show a closed message)
                </label>
              </FormGrid>
            </SettingsCard>
            <SettingsCard title={`Fields (${fields.length})`} description="Map fields to lead fields. Answers that are not mapped are added to the lead requirement.">
              {errors.fields && (
                <p role="alert" className="mb-3 text-sm text-danger-text">
                  {errors.fields}
                </p>
              )}
              <ol className="flex flex-col gap-3">
                {fields.map((f, i) => (
                  <li key={f.key} className="rounded-md border border-border p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-fg-secondary">
                        Field {i + 1}: {TYPE_LABEL[f.type]}
                      </span>
                      <span className="flex gap-0.5">
                        <Button size="icon-sm" variant="ghost" aria-label={`Move ${f.label || `field ${i + 1}`} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                          <ArrowUp aria-hidden />
                        </Button>
                        <Button size="icon-sm" variant="ghost" aria-label={`Move ${f.label || `field ${i + 1}`} down`} disabled={i === fields.length - 1} onClick={() => move(i, 1)}>
                          <ArrowDown aria-hidden />
                        </Button>
                        <Button size="icon-sm" variant="ghost" aria-label={`Remove ${f.label || `field ${i + 1}`}`} disabled={fields.length === 1} onClick={() => setFields(fields.filter((_, j) => j !== i))}>
                          <Trash2 aria-hidden />
                        </Button>
                      </span>
                    </div>
                    <FormGrid className="xl:grid-cols-3">
                      <FormField label="Label" required error={errors[`fields.${i}.label`]}>
                        <Input value={f.label} maxLength={120} onChange={(e) => setF(i, { label: e.target.value, ...(form ? {} : { id: f.id === slug(f.label) || !f.id ? slug(e.target.value) : f.id }) })} />
                      </FormField>
                      <FormField label="Key" error={errors[`fields.${i}.id`]} hint="Input name; used in exports and the API">
                        <Input value={f.id} maxLength={40} className="font-mono" onChange={(e) => setF(i, { id: e.target.value.toLowerCase() })} />
                      </FormField>
                      <FormField label="Type">
                        <NativeSelect value={f.type} onChange={(e) => setF(i, { type: e.target.value as CaptureFieldType })}>
                          {CAPTURE_FIELD_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {TYPE_LABEL[t]}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormField>
                      <FormField label="Saves into">
                        <NativeSelect value={f.mapTo ?? ''} onChange={(e) => setF(i, { mapTo: e.target.value || null })}>
                          <option value="">Lead requirement (not mapped)</option>
                          {targets.map((t) => (
                            <option key={t.value} value={t.value} disabled={t.value !== 'tags' && used.has(t.value) && f.mapTo !== t.value}>
                              {t.label}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormField>
                      {f.type === 'hidden' ? (
                        <>
                          <FormField label="URL parameter" hint="e.g. campaign reads ?campaign=diwali">
                            <Input value={f.param ?? ''} maxLength={40} onChange={(e) => setF(i, { param: e.target.value || null })} />
                          </FormField>
                          <FormField label="Default value">
                            <Input value={f.defaultValue ?? ''} maxLength={200} onChange={(e) => setF(i, { defaultValue: e.target.value || null })} />
                          </FormField>
                        </>
                      ) : (
                        <>
                          <FormField label="Placeholder">
                            <Input value={f.placeholder ?? ''} maxLength={120} onChange={(e) => setF(i, { placeholder: e.target.value || null })} />
                          </FormField>
                          <FormField label="Help text">
                            <Input value={f.helpText ?? ''} maxLength={300} onChange={(e) => setF(i, { helpText: e.target.value || null })} />
                          </FormField>
                        </>
                      )}
                    </FormGrid>
                    {(f.type === 'select' || f.type === 'multi_select') && (
                      <div className="mt-3">
                        <TagsInput label="Options" value={f.options.map((o) => o.label)} onChange={(labels) => setF(i, { options: labels.map((l) => ({ value: slug(l), label: l })) })} max={100} />
                        {errors[`fields.${i}.options`] && (
                          <p role="alert" className="mt-1 text-xs text-danger-text">
                            {errors[`fields.${i}.options`]}
                          </p>
                        )}
                      </div>
                    )}
                    {f.type !== 'hidden' && (
                      <div className="mt-3 flex items-center gap-2">
                        <Checkbox id={`req-${f.key}`} checked={f.required} onCheckedChange={(v) => setF(i, { required: v === true })} />
                        <label htmlFor={`req-${f.key}`} className="text-sm text-fg">
                          Required
                        </label>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              <Button className="mt-3" disabled={fields.length >= 40} onClick={() => setFields([...fields, field({ id: `field_${fields.length + 1}`, label: '', type: 'text' })])}>
                <Plus aria-hidden />
                Add field
              </Button>
            </SettingsCard>
            <SettingsCard title="After submit">
              <FormGrid>
                <FormField label="Button text" required error={errors.submitLabel}>
                  <Input value={settings.submitLabel} maxLength={40} onChange={(e) => setS({ submitLabel: e.target.value })} />
                </FormField>
                <FormField label="Redirect to (optional)" error={errors.redirectUrl} hint="Instead of the thank-you message">
                  <Input type="url" value={settings.redirectUrl} onChange={(e) => setS({ redirectUrl: e.target.value })} />
                </FormField>
                <FormField label="Thank-you message" required error={errors.successMessage} className="sm:col-span-2">
                  <Input value={settings.successMessage} maxLength={300} onChange={(e) => setS({ successMessage: e.target.value })} />
                </FormField>
              </FormGrid>
            </SettingsCard>
            <SettingsCard title="New leads">
              <FormGrid>
                <FormField label="Owner" hint="Empty = lead routing decides">
                  <OwnerSelect value={settings.ownerId} onChange={(ownerId) => setS({ ownerId })} />
                </FormField>
                <FormField label="Stage" hint="Empty = the first stage">
                  <NativeSelect value={settings.stageId ?? ''} onChange={(e) => setS({ stageId: e.target.value || null })}>
                    <option value="">First stage</option>
                    {(pipeline.data?.stages ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label="Duplicates">
                  <NativeSelect value={settings.dedupe} onChange={(e) => setS({ dedupe: e.target.value as SettingsDraft['dedupe'] })}>
                    <option value="phone_or_email">Same phone or email: add a note to the open lead</option>
                    <option value="none">Always create a new lead</option>
                  </NativeSelect>
                </FormField>
                <label className="flex items-center gap-3 self-end pb-1.5 text-sm text-fg">
                  <Switch checked={settings.notifyOwner} onCheckedChange={(notifyOwner) => setS({ notifyOwner })} />
                  Notify the owner
                </label>
              </FormGrid>
              <div className="mt-3">
                <TagsInput label="Tags on new leads" value={settings.defaultTags} onChange={(defaultTags) => setS({ defaultTags })} max={10} />
              </div>
            </SettingsCard>
            <SettingsCard title="Consent and look">
              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-3 text-sm text-fg">
                  <Switch checked={settings.consentEnabled} onCheckedChange={(consentEnabled) => setS({ consentEnabled })} />
                  Show a consent checkbox (recorded with the lead)
                </label>
                {settings.consentEnabled && (
                  <>
                    <label className="flex items-center gap-3 text-sm text-fg">
                      <Switch checked={settings.consentRequired} onCheckedChange={(consentRequired) => setS({ consentRequired })} />
                      Visitors must tick it to send
                    </label>
                    <FormField label="Consent text">
                      <Textarea rows={2} value={settings.consentText} maxLength={500} onChange={(e) => setS({ consentText: e.target.value })} />
                    </FormField>
                  </>
                )}
                <FormGrid>
                  <FormField label="Layout">
                    <NativeSelect value={settings.layout} onChange={(e) => setS({ layout: e.target.value as SettingsDraft['layout'] })}>
                      <option value="card">Card</option>
                      <option value="plain">Plain (for embedding)</option>
                    </NativeSelect>
                  </FormField>
                  <label className="flex items-center gap-3 self-end pb-1.5 text-sm text-fg">
                    <Switch checked={settings.showLogo} onCheckedChange={(showLogo) => setS({ showLogo })} />
                    Show your logo
                  </label>
                </FormGrid>
              </div>
            </SettingsCard>
          </div>
          <aside className="flex min-w-0 flex-col gap-4 2xl:sticky 2xl:top-0 2xl:self-start">
            <section aria-labelledby="capture-preview-title" className="flex flex-col gap-2">
              <h2 id="capture-preview-title" className="text-sm font-semibold text-fg">
                Live preview
              </h2>
              <div className="rounded-lg bg-bg p-4">
                <CaptureFormRenderer key={previewKey} form={previewForm} logoUrl={me?.workspace.branding?.logoLight?.url ?? null} workspaceName={me?.workspace.branding?.displayName ?? me?.workspace.name ?? ''} preview />
              </div>
            </section>
            {form ? (
              <SettingsCard title="Share and embed">
                <div className="flex flex-col gap-3">
                  <FormField label="Hosted page">
                    <Input readOnly value={form.hostedUrl} onFocus={(e) => e.currentTarget.select()} />
                  </FormField>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => void copyText(form.hostedUrl, 'Form link')}>
                      <Copy aria-hidden />
                      Copy link
                    </Button>
                    <Button size="sm" asChild>
                      <a href={form.hostedUrl} target="_blank" rel="noreferrer">
                        <ExternalLink aria-hidden />
                        Open
                      </a>
                    </Button>
                  </div>
                  <FormField label="Embed snippet" hint="Paste into your website HTML; the form resizes itself. UTM tags in the page link are captured.">
                    <Textarea readOnly rows={4} className="font-mono text-xs" value={form.embedHtml} onFocus={(e) => e.currentTarget.select()} />
                  </FormField>
                  <Button size="sm" className="self-start" onClick={() => void copyText(form.embedHtml, 'Embed snippet')}>
                    <Code aria-hidden />
                    Copy embed snippet
                  </Button>
                </div>
              </SettingsCard>
            ) : (
              <p className="text-xs text-muted-strong">Create the form to get its hosted page link and embed snippet.</p>
            )}
          </aside>
        </form>
      )}
      {form && (
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title={`Delete ${form.name}?`}
          description="The hosted page and embeds stop working. Leads already created stay."
          confirmLabel="Delete form"
          loading={m.remove.isPending}
          onConfirm={() =>
            m.remove.mutate(form.id, {
              onSuccess: () => {
                toast.success('Form deleted');
                router.push('/app/settings/lead-capture');
              },
              onError: (e) => toast.error(formErrorMessage(e)),
            })
          }
        />
      )}
    </div>
  );
}

function Submissions({ form }: { form: CaptureForm }) {
  const now = useNow(60_000);
  const q = useCaptureSubmissions(form.id);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const label = (id: string) => form.fields.find((f) => f.id === id)?.label ?? id;
  return (
    <SettingsCard title="Recent submissions">
      {q.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : q.isError ? (
        <p className="text-sm text-muted-strong">
          Submissions did not load.{' '}
          <Button size="sm" variant="link" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-strong">No submissions yet. Share the hosted page or embed the form on your website.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((s) => (
            <li key={s.id} className="flex flex-col gap-1 py-3">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-fg">{String(s.values[form.fields.find((f) => f.mapTo === 'name')?.id ?? 'name'] ?? 'Submission')}</span>
                <span className="text-xs text-muted-strong">{ago(s.createdAt, now)}</span>
                {s.leadId && (
                  <Link className="focus-ring rounded-sm text-xs font-medium text-accent-text hover:underline" href={`/app/leads/${s.leadId}`}>
                    Open lead
                  </Link>
                )}
                {s.duplicateOfLeadId && (
                  <Link className="focus-ring rounded-sm text-xs hover:underline" href={`/app/leads/${s.duplicateOfLeadId}`}>
                    Added to an existing lead
                  </Link>
                )}
                {s.utm.source && <Chip>utm {s.utm.source}</Chip>}
                {s.consent && <Chip tone="green">Consent</Chip>}
              </p>
              <p className="text-xs text-fg-secondary">
                {Object.entries(s.values)
                  .filter(([, v]) => v !== null && v !== '' && v !== undefined)
                  .map(([key, v]) => `${label(key)}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
                  .join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}
      {q.hasNextPage && (
        <Button size="sm" variant="ghost" className="mt-2" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
          Show older
        </Button>
      )}
    </SettingsCard>
  );
}
