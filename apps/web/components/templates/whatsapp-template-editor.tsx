'use client';

import {
  renderWhatsappBody,
  TEMPLATE_CATEGORIES,
  WHATSAPP_HEADER_FORMATS,
  whatsappBodyVariables,
  whatsappTemplateProblems,
  WhatsAppTemplateNameSchema,
  type RouteBody,
  type TemplateCategory,
  type WhatsAppHeaderFormat,
  type WhatsAppTemplate,
  type WhatsAppTemplateButton,
} from '@vistar/shared';
import { ArrowLeft, Copy, Plus, Send, Trash2 } from 'lucide-react';
import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { formatDateTimeIn } from '@/components/common/time';
import { InlineAlert, LoadError } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { brandName } from '@/lib/branding';
import { useWhatsAppTemplateMutations, useWhatsAppTemplates } from '@/lib/config/company';
import { focusFirstInvalid, formErrorMessage, serverFieldErrors } from '@/lib/crm/ui/errors';
import { useCan, useMe } from '@/lib/session/session';
import { WhatsAppBubble } from './whatsapp-bubble';
import { CATEGORY_HELP, CATEGORY_LABEL, WA_LANGUAGES, WA_STATUS, WhatsAppStatusChip } from './whatsapp-status';

/** Vistar fields a numbered variable can be filled from (workflows, quick sends from the inbox). */
const VISTAR_FIELDS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Typed by the sender' },
  { value: 'lead.name', label: 'Lead name' },
  { value: 'lead.firstName', label: 'Lead first name' },
  { value: 'lead.company', label: 'Lead company' },
  { value: 'lead.phone', label: 'Lead phone' },
  { value: 'lead.city', label: 'Lead city' },
  { value: 'owner.name', label: 'Owner name' },
  { value: 'owner.phone', label: 'Owner phone' },
  { value: 'workspace.name', label: 'Your company name' },
  { value: 'quotation.number', label: 'Quotation number' },
  { value: 'quotation.total', label: 'Quotation total' },
  { value: 'quotation.link', label: 'Quotation link' },
  { value: 'invoice.number', label: 'Invoice number' },
  { value: 'invoice.amountDue', label: 'Invoice amount due' },
  { value: 'invoice.link', label: 'Invoice link' },
  { value: 'meeting.time', label: 'Meeting time' },
];

const HEADER_LABEL: Record<WhatsAppHeaderFormat, string> = { none: 'No header', text: 'Text', image: 'Image', video: 'Video', document: 'Document (PDF)' };
const BUTTON_LABEL: Record<WhatsAppTemplateButton['type'], string> = { quick_reply: 'Quick reply', url: 'Website link', phone: 'Call button' };

interface Draft {
  name: string;
  language: string;
  category: TemplateCategory;
  headerFormat: WhatsAppHeaderFormat;
  headerText: string;
  headerExample: string;
  body: string;
  examples: string[];
  variables: string[];
  footer: string;
  buttons: WhatsAppTemplateButton[];
}

function toDraft(t: WhatsAppTemplate | null, copy = false): Draft {
  return {
    name: t ? (copy ? nextName(t.name) : t.name) : '',
    language: t?.language ?? 'en',
    category: t?.category ?? 'utility',
    headerFormat: t?.header.format ?? 'none',
    headerText: t?.header.text ?? '',
    headerExample: t?.header.example ?? '',
    body: t?.body ?? '',
    examples: [...(t?.bodyExamples ?? [])],
    variables: [...(t?.variables ?? [])],
    footer: t?.footer ?? '',
    buttons: t ? t.buttons.map((b) => ({ ...b })) : [],
  };
}

/** order_update -> order_update_v2, order_update_v2 -> order_update_v3 */
function nextName(name: string): string {
  const m = /^(.*)_v(\d+)$/.exec(name);
  return m ? `${m[1]}_v${Number(m[2]) + 1}` : `${name}_v2`;
}

function toBody(d: Draft): RouteBody<'whatsappTemplateCreate'> {
  const vars = whatsappBodyVariables(d.body).sort((a, b) => a - b);
  return {
    name: d.name.trim(),
    language: d.language,
    category: d.category,
    header: {
      format: d.headerFormat,
      text: d.headerFormat === 'text' ? d.headerText.trim() || null : null,
      example: d.headerFormat === 'none' ? null : d.headerExample.trim() || null,
    },
    body: d.body.trim(),
    bodyExamples: vars.map((n) => (d.examples[n - 1] ?? '').trim()).filter(Boolean),
    variables: vars.map((n) => d.variables[n - 1] ?? ''),
    footer: d.footer.trim() || null,
    buttons: d.buttons,
  };
}

export function WhatsAppTemplateEditor({
  id,
  copyOf,
  onClose,
  onCreated,
  onDuplicate,
}: {
  id: string | null;
  copyOf: WhatsAppTemplate | null;
  onClose: () => void;
  onCreated: (t: WhatsAppTemplate) => void;
  onDuplicate: (t: WhatsAppTemplate) => void;
}) {
  const q = useWhatsAppTemplates();
  if (id && q.isPending)
    return (
      <div role="status" aria-label="Loading the template" className="grid gap-4 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Skeleton className="h-[560px] w-full rounded-lg" />
        <Skeleton className="h-80 w-full rounded-lg" />
      </div>
    );
  if (id && q.isError) return <LoadError title="The template did not load" onRetry={() => void q.refetch()} />;
  const template = id ? (q.data?.find((t) => t.id === id) ?? null) : null;
  if (id && !template)
    return (
      <div className="flex flex-col gap-3">
        <BackButton onClick={onClose} />
        <LoadError title="This template no longer exists" onRetry={() => void q.refetch()} />
      </div>
    );
  return <EditorForm key={template ? `${template.id}:${template.updatedAt}` : `new:${copyOf?.id ?? ''}`} template={template} copyOf={copyOf} onClose={onClose} onCreated={onCreated} onDuplicate={onDuplicate} />;
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="-ml-2 w-max" onClick={onClick}>
      <ArrowLeft aria-hidden />
      All WhatsApp templates
    </Button>
  );
}

function EditorForm({
  template,
  copyOf,
  onClose,
  onCreated,
  onDuplicate,
}: {
  template: WhatsAppTemplate | null;
  copyOf: WhatsAppTemplate | null;
  onClose: () => void;
  onCreated: (t: WhatsAppTemplate) => void;
  onDuplicate: (t: WhatsAppTemplate) => void;
}) {
  const formId = useId();
  const me = useMe();
  const m = useWhatsAppTemplateMutations();
  const canManage = useCan('templates.manage');
  const { readOnly, reason } = useReadOnly();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const isNew = !template;
  const editable = canManage && !readOnly && (!template || template.editable);
  const [initial] = useState(() => toDraft(template ?? copyOf, !template && !!copyOf));
  const [d, setD] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const set = (patch: Partial<Draft>) => {
    setD((x) => ({ ...x, ...patch }));
    setFormError(null);
  };

  const vars = useMemo(() => whatsappBodyVariables(d.body).sort((a, b) => a - b), [d.body]);
  const body = useMemo(() => toBody(d), [d]);
  const problems = useMemo(
    () => whatsappTemplateProblems({ body: body.body, bodyExamples: body.bodyExamples ?? [], header: { format: d.headerFormat, text: body.header?.text ?? null, example: body.header?.example ?? null }, buttons: d.buttons }),
    [body, d.headerFormat, d.buttons],
  );
  const saving = m.create.isPending || m.update.isPending;

  function addVariable() {
    const n = (vars.length ? Math.max(...vars) : 0) + 1;
    const token = `{{${n}}}`;
    const el = bodyRef.current;
    const start = el?.selectionStart ?? d.body.length;
    const end = el?.selectionEnd ?? d.body.length;
    set({ body: d.body.slice(0, start) + token + d.body.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function validate(forSubmit: boolean): Record<string, string> {
    const errs: Record<string, string> = {};
    if (isNew) {
      const name = WhatsAppTemplateNameSchema.safeParse(d.name.trim());
      if (!name.success) errs.name = name.error.issues[0]?.message ?? 'Use lowercase letters, digits and underscores.';
    }
    if (!d.body.trim()) errs.body = 'Enter the message.';
    else if (d.body.length > 1024) errs.body = 'Keep the message under 1,024 characters.';
    if (d.headerFormat === 'text' && d.headerText.length > 60) errs['header.text'] = 'Keep the header under 60 characters.';
    if (d.footer.length > 60) errs.footer = 'Keep the footer under 60 characters.';
    d.buttons.forEach((b, i) => {
      if (!b.text.trim()) errs[`buttons.${i}.text`] = 'Enter the button text.';
      if (b.type === 'url' && !/^https:\/\//.test(b.url)) errs[`buttons.${i}.url`] = 'Use an https link.';
      if (b.type === 'phone' && !/^\+[1-9]\d{6,14}$/.test(b.phone)) errs[`buttons.${i}.phone`] = 'Use +91 and the number, e.g. +919876543210.';
    });
    if (forSubmit) for (const p of problems) if (!errs[p.path]) errs[p.path] = p.message;
    return errs;
  }

  async function save(submit: boolean): Promise<void> {
    const errs = validate(submit);
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError(submit ? 'Fix the highlighted fields before you submit to Meta.' : 'Fix the highlighted fields to save.');
      focusFirstInvalid(formId);
      return;
    }
    try {
      let saved: WhatsAppTemplate;
      if (!template) saved = await m.create.mutateAsync(body);
      else {
        const { name: _name, language: _language, ...patch } = body;
        saved = dirty ? await m.update.mutateAsync({ id: template.id, body: patch }) : template;
      }
      if (submit) {
        saved = await m.submit.mutateAsync(saved.id);
        toast.success(`${saved.name} sent to Meta for review${saved.mode === 'mock' ? ' (development mock)' : ''}`);
      } else toast.success(template ? `${saved.name} saved` : `${saved.name} saved as a draft`);
      if (!template) onCreated(saved);
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFormError(formErrorMessage(err));
      focusFirstInvalid(formId);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save(false);
  };

  const headerPreview = d.headerFormat === 'none' ? null : d.headerFormat === 'text' ? { kind: 'text' as const, text: renderWhatsappBody(d.headerText, d.headerExample ? [d.headerExample] : []) } : { kind: d.headerFormat };
  const previewButtons = d.buttons.map((b) => ({ type: b.type === 'phone' ? 'phone_number' : b.type, text: b.text }));
  const businessName = brandName(me?.workspace);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <BackButton onClick={onClose} />
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-mono text-lg font-semibold text-fg">{template ? template.name : 'New WhatsApp template'}</h2>
          {template && <WhatsAppStatusChip status={template.status} />}
          {template?.mode === 'mock' && <span className="text-xs text-muted-strong">Development mock</span>}
        </div>
        {template && (
          <p className="text-xs text-muted-strong">
            {[WA_STATUS[template.status].hint, template.submittedAt ? `Submitted ${formatDateTimeIn(template.submittedAt, tz)}` : null, template.lastSyncedAt ? `last sync ${formatDateTimeIn(template.lastSyncedAt, tz)}` : null].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      {template?.status === 'rejected' && template.rejectionReason && (
        <InlineAlert title="Meta rejected this template">{`${template.rejectionReason} Change the text and submit it again.`}</InlineAlert>
      )}
      {template && !template.editable && (
        <InlineAlert tone="info" title="Submitted templates cannot be edited">
          Meta fixes the text once it is in review or approved. To change it, duplicate it as a new template (for example {nextName(template.name)}) and submit that.
        </InlineAlert>
      )}
      {readOnly && reason && <InlineAlert tone="info">{reason}</InlineAlert>}

      <div className="grid min-w-0 items-start gap-4 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <form id={formId} noValidate onSubmit={onSubmit} className="flex min-w-0 flex-col gap-4">
          <Card className="flex flex-col gap-4 p-4">
            {formError && <InlineAlert>{formError}</InlineAlert>}
            <div className="grid gap-4 md:grid-cols-3">
              <FormField label="Template name" required error={errors.name} hint={isNew ? 'Lowercase, digits and _; fixed after creating' : 'Fixed after creating'}>
                <Input value={d.name} disabled={!isNew || !editable} spellCheck={false} maxLength={512} className="font-mono" placeholder="quotation_follow_up" onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
              </FormField>
              <FormField label="Language" required hint={isNew ? 'One template per language' : 'Fixed after creating'}>
                <NativeSelect value={d.language} disabled={!isNew || !editable} onChange={(e) => set({ language: e.target.value })}>
                  {WA_LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>{`${l.label} (${l.value})`}</option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="Category" required hint={CATEGORY_HELP[d.category]}>
                <NativeSelect value={d.category} disabled={!editable} onChange={(e) => set({ category: e.target.value as TemplateCategory })}>
                  {TEMPLATE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            </div>

            <fieldset className="flex min-w-0 flex-col gap-3">
              <legend className="mb-1 text-sm font-semibold text-fg">Header</legend>
              <div className="grid gap-4 md:grid-cols-3">
                <FormField label="Header type">
                  <NativeSelect value={d.headerFormat} disabled={!editable} onChange={(e) => set({ headerFormat: e.target.value as WhatsAppHeaderFormat })}>
                    {WHATSAPP_HEADER_FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {HEADER_LABEL[f]}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                {d.headerFormat === 'text' && (
                  <>
                    <FormField label="Header text" error={errors['header.text']} hint="Up to 60 characters; {{1}} at most once">
                      <Input value={d.headerText} maxLength={60} disabled={!editable} onChange={(e) => set({ headerText: e.target.value })} />
                    </FormField>
                    {/\{\{\s*1\s*\}\}/.test(d.headerText) && (
                      <FormField label="Example for {{1}}" error={errors['header.example']}>
                        <Input value={d.headerExample} disabled={!editable} onChange={(e) => set({ headerExample: e.target.value })} />
                      </FormField>
                    )}
                  </>
                )}
                {(d.headerFormat === 'image' || d.headerFormat === 'video' || d.headerFormat === 'document') && (
                  <FormField label="Sample file link" error={errors['header.example']} hint="https link Meta can download for the review; each send attaches its own file" className="md:col-span-2">
                    <Input type="url" value={d.headerExample} disabled={!editable} placeholder="https://example.com/catalogue.pdf" onChange={(e) => set({ headerExample: e.target.value })} />
                  </FormField>
                )}
              </div>
            </fieldset>

            <div className="flex min-w-0 flex-col gap-1.5">
              <FormField label="Message" required error={errors.body} hint="Up to 1,024 characters. *bold*, _italic_, ~strike~. Variables are numbered {{1}}, {{2}} in order and cannot start or end the message.">
                <Textarea ref={bodyRef} rows={6} value={d.body} maxLength={1024} disabled={!editable} onChange={(e) => set({ body: e.target.value })} />
              </FormField>
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={!editable || vars.length >= 20} onClick={addVariable}>
                  <Plus aria-hidden />
                  Add variable
                </Button>
                <span className="ml-auto text-xs text-muted-strong tabular">{`${d.body.length} / 1024`}</span>
              </div>
            </div>

            {vars.length > 0 && (
              <fieldset className="flex min-w-0 flex-col gap-2">
                <legend className="mb-1 text-sm font-semibold text-fg">Variables</legend>
                {errors.bodyExamples && <p role="alert" className="text-xs text-danger-text">{errors.bodyExamples}</p>}
                <p className="text-xs text-muted-strong">Meta needs a realistic example for each variable. Pick the Vistar field that fills it when workflows or the inbox send this template.</p>
                <ul className="flex flex-col gap-2">
                  {vars.map((n) => (
                    <li key={n} className="grid items-end gap-2 sm:grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)]">
                      <code className="pb-2 font-mono text-sm text-fg">{`{{${n}}}`}</code>
                      <FormField label={`Example for {{${n}}}`} required>
                        <Input
                          value={d.examples[n - 1] ?? ''}
                          maxLength={200}
                          disabled={!editable}
                          onChange={(e) => {
                            const examples = [...d.examples];
                            examples[n - 1] = e.target.value;
                            set({ examples });
                          }}
                        />
                      </FormField>
                      <FormField label="Filled from">
                        <NativeSelect
                          value={d.variables[n - 1] ?? ''}
                          disabled={!editable}
                          onChange={(e) => {
                            const variables = [...d.variables];
                            variables[n - 1] = e.target.value;
                            set({ variables });
                          }}
                        >
                          {VISTAR_FIELDS.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormField>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}

            <FormField label="Footer" error={errors.footer} hint="Optional, up to 60 characters, no variables">
              <Input value={d.footer} maxLength={60} disabled={!editable} placeholder="Reply STOP to opt out" onChange={(e) => set({ footer: e.target.value })} />
            </FormField>

            <ButtonsEditor buttons={d.buttons} errors={errors} disabled={!editable} onChange={(buttons) => set({ buttons })} />

            {problems.length > 0 && editable && (
              <InlineAlert tone="warning" title="Meta would reject this">
                <ul className="list-disc pl-4">
                  {problems.map((p) => (
                    <li key={`${p.path}:${p.message}`}>{p.message}</li>
                  ))}
                </ul>
              </InlineAlert>
            )}
          </Card>

          <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg border border-border bg-surface-2 px-4 py-3">
            <p className="mr-auto text-xs text-muted-strong" aria-live="polite">
              {editable ? (dirty ? 'You have unsaved changes' : '') : readOnly ? reason : canManage ? 'View only' : 'Your role can view templates but not change them.'}
            </p>
            {template && canManage && !readOnly && (
              <Button onClick={() => onDuplicate(template)}>
                <Copy aria-hidden />
                Duplicate
              </Button>
            )}
            {editable && (
              <>
                <Button type="submit" loading={saving && !m.submit.isPending} disabled={!isNew && !dirty}>
                  {isNew ? 'Save draft' : 'Save changes'}
                </Button>
                <Button variant="primary" loading={m.submit.isPending} disabled={saving} onClick={() => void save(true)}>
                  <Send aria-hidden />
                  {isNew || dirty ? 'Save and submit to Meta' : 'Submit to Meta'}
                </Button>
              </>
            )}
          </div>
        </form>

        <Card className="min-w-0 p-4 2xl:sticky 2xl:top-4">
          <WhatsAppBubble header={headerPreview} body={d.body} footer={d.footer} buttons={previewButtons} samples={d.examples} businessName={businessName} />
          <p className="mt-3 text-xs text-muted-strong">Variables show the example values. Highlighted amber: no example yet.</p>
        </Card>
      </div>
    </div>
  );
}

function ButtonsEditor({ buttons, errors, disabled, onChange }: { buttons: WhatsAppTemplateButton[]; errors: Record<string, string>; disabled: boolean; onChange: (b: WhatsAppTemplateButton[]) => void }) {
  const count = (t: WhatsAppTemplateButton['type']) => buttons.filter((b) => b.type === t).length;
  const add = (type: WhatsAppTemplateButton['type']) =>
    onChange([...buttons, type === 'url' ? { type, text: '', url: 'https://', example: null } : type === 'phone' ? { type, text: 'Call us', phone: '+91' } : { type, text: '' }]);
  const update = (i: number, patch: Partial<WhatsAppTemplateButton>) => onChange(buttons.map((b, j) => (j === i ? ({ ...b, ...patch } as WhatsAppTemplateButton) : b)));
  const remove = (i: number) => onChange(buttons.filter((_, j) => j !== i));

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold text-fg">Buttons</legend>
      {errors.buttons && <p role="alert" className="text-xs text-danger-text">{errors.buttons}</p>}
      {buttons.length === 0 && <p className="text-xs text-muted-strong">Optional. Up to 10 buttons: quick replies, at most two website links and one call button.</p>}
      <ul className="flex flex-col gap-2">
        {buttons.map((b, i) => (
          <li key={i} className="grid items-end gap-2 rounded-md border border-border p-2 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1.5fr)_auto]">
            <span className="pb-2 text-xs font-medium text-fg-secondary">{BUTTON_LABEL[b.type]}</span>
            <FormField label="Button text" error={errors[`buttons.${i}.text`]}>
              <Input value={b.text} maxLength={25} disabled={disabled} onChange={(e) => update(i, { text: e.target.value })} />
            </FormField>
            {b.type === 'url' ? (
              <FormField label="Link" error={errors[`buttons.${i}.url`] ?? errors[`buttons.${i}.example`]} hint="May end with {{1}} for a dynamic part">
                <Input type="url" value={b.url} disabled={disabled} onChange={(e) => update(i, { url: e.target.value })} />
              </FormField>
            ) : b.type === 'phone' ? (
              <FormField label="Phone" error={errors[`buttons.${i}.phone`]}>
                <Input type="tel" value={b.phone} disabled={disabled} onChange={(e) => update(i, { phone: e.target.value.replace(/[^\d+]/g, '') })} />
              </FormField>
            ) : (
              <span aria-hidden />
            )}
            <Button size="icon-sm" variant="ghost" disabled={disabled} aria-label={`Remove button ${i + 1}`} onClick={() => remove(i)} className="mb-0.5">
              <Trash2 aria-hidden />
            </Button>
            {b.type === 'url' && /\{\{\s*1\s*\}\}\s*$/.test(b.url) && (
              <FormField label="Example full link" className="sm:col-span-4" error={errors[`buttons.${i}.example`]}>
                <Input type="url" value={b.example ?? ''} disabled={disabled} placeholder="https://shop.example.com/orders/1042" onChange={(e) => update(i, { example: e.target.value || null })} />
              </FormField>
            )}
          </li>
        ))}
      </ul>
      {!disabled && buttons.length < 10 && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => add('quick_reply')}>
            <Plus aria-hidden />
            Quick reply
          </Button>
          <Button size="sm" disabled={count('url') >= 2} onClick={() => add('url')}>
            <Plus aria-hidden />
            Website link
          </Button>
          <Button size="sm" disabled={count('phone') >= 1} onClick={() => add('phone')}>
            <Plus aria-hidden />
            Call button
          </Button>
        </div>
      )}
    </fieldset>
  );
}
