'use client';

import {
  checkEmailTemplate,
  templateVariablesUsed,
  type EmailBrand,
  type EmailTemplateScope,
  type EmailTemplateVariable,
  type TemplateValues,
} from '@vistar/shared';
import { ArrowLeft, RotateCcw, Send } from 'lucide-react';
import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { InlineAlert } from '@/components/settings/common/states';
import { SaveBar } from '@/components/settings/settings-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { focusFirstInvalid, formErrorMessage, serverFieldErrors } from '@/lib/crm/ui/errors';
import { EmailPreview } from './email-preview';
import { VariablePicker } from './variable-picker';

export interface EmailTemplateDraft {
  subject: string;
  html: string;
}

export interface TestSendResult {
  ok: boolean;
  message: string;
}

export interface EmailTemplateEditorProps {
  scope: EmailTemplateScope;
  templateKey: string;
  label: string;
  description: string;
  /** Saved override, or the default when not customised. */
  value: EmailTemplateDraft;
  customised: boolean;
  variables: readonly EmailTemplateVariable[];
  sample: TemplateValues;
  brand: EmailBrand;
  fromLine?: string;
  /** "Changed 2 Nov, 4:10 pm by Anita" */
  lastChange?: string | null;
  onSave: (draft: EmailTemplateDraft) => Promise<EmailTemplateDraft>;
  onReset: () => Promise<EmailTemplateDraft>;
  onTestSend: (input: EmailTemplateDraft & { to: string }) => Promise<TestSendResult>;
  saving: boolean;
  resetting: boolean;
  testing: boolean;
  defaultRecipient?: string;
  readOnlyReason?: string | null;
  onBack: () => void;
  backLabel: string;
}

const MAX_SUBJECT = 250;
const MAX_HTML = 50_000;

/**
 * One e-mail template: subject and HTML body with a variable picker, live checks (unknown variables,
 * required ones missing, markup the server will strip), a live preview with sample data in both
 * themes, a test send and reset to default. Used by Super Admin > Config (platform templates) and by
 * Company > Settings > E-mail templates (company branding in the preview).
 */
export function EmailTemplateEditor(props: EmailTemplateEditorProps) {
  const { scope, templateKey, label, description, value, customised, variables, sample, brand, fromLine, lastChange, onSave, onReset, onTestSend, saving, resetting, testing, defaultRecipient, readOnlyReason, onBack, backLabel } = props;
  const formId = useId();
  const [initial, setInitial] = useState<EmailTemplateDraft>(value);
  const [draft, setDraft] = useState<EmailTemplateDraft>(value);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastField = useRef<keyof EmailTemplateDraft>('html');
  const dirty = draft.subject !== initial.subject || draft.html !== initial.html;

  const problems = useMemo(() => checkEmailTemplate(scope, templateKey, draft.subject, draft.html), [scope, templateKey, draft.subject, draft.html]);
  const used = useMemo(() => [...templateVariablesUsed(draft.subject), ...templateVariablesUsed(draft.html)], [draft.subject, draft.html]);
  const blocking = problems.unknownVariables.length > 0 || problems.missingRequired.length > 0;

  const set = (patch: Partial<EmailTemplateDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setFormError(null);
  };

  function insert(name: string) {
    const token = `{{${name}}}`;
    const field = lastField.current;
    const el = field === 'subject' ? subjectRef.current : bodyRef.current;
    const current = draft[field];
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    set({ [field]: current.slice(0, start) + token + current.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!draft.subject.trim()) errs.subject = 'Enter a subject.';
    else if (draft.subject.length > MAX_SUBJECT) errs.subject = `Keep the subject under ${MAX_SUBJECT} characters.`;
    if (!draft.html.trim()) errs.html = 'Enter the message.';
    else if (draft.html.length > MAX_HTML) errs.html = 'The message is too long.';
    if (problems.unknownVariables.length) errs.html = `Remove the unknown ${problems.unknownVariables.length === 1 ? 'variable' : 'variables'} ${problems.unknownVariables.map((v) => `{{${v}}}`).join(', ')}.`;
    else if (problems.missingRequired.length) errs.html = `Add ${problems.missingRequired.map((v) => `{{${v}}}`).join(', ')}: the e-mail does not work without it.`;
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError(Object.keys(errs).length === 1 ? 'Fix the highlighted field to save.' : 'Fix the highlighted fields to save.');
      focusFirstInvalid(formId);
      return;
    }
    try {
      const saved = await onSave({ subject: draft.subject.trim(), html: draft.html });
      setInitial(saved);
      setDraft(saved);
      setErrors({});
      toast.success(`${label} saved`);
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFormError(formErrorMessage(err));
      focusFirstInvalid(formId);
    }
  }

  async function reset() {
    try {
      const d = await onReset();
      setInitial(d);
      setDraft(d);
      setErrors({});
      setFormError(null);
      setConfirmReset(false);
      toast.success(`${label} uses the default again`);
    } catch (err) {
      toast.error(formErrorMessage(err, 'The template was not reset. Try again.'));
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Button variant="ghost" size="sm" className="-ml-2 w-max" onClick={onBack}>
          <ArrowLeft aria-hidden />
          {backLabel}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-fg">{label}</h2>
          {customised ? <Chip tone="indigo">Customised</Chip> : <Chip>Default</Chip>}
          {dirty && <Chip tone="amber">Unsaved</Chip>}
        </div>
        <p className="text-sm text-muted-strong">{description}</p>
        {lastChange && <p className="text-xs text-muted-strong">{lastChange}</p>}
      </div>

      <div className="grid min-w-0 items-start gap-4 2xl:grid-cols-2">
        <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="flex min-w-0 flex-col gap-4">
          <Card className="flex flex-col gap-4 p-4">
            {formError && <InlineAlert>{formError}</InlineAlert>}
            <FormField label="Subject" required error={errors.subject} hint="Plain text, one line. Variables work here too.">
              <Input
                ref={subjectRef}
                value={draft.subject}
                maxLength={MAX_SUBJECT}
                disabled={!!readOnlyReason}
                onFocus={() => (lastField.current = 'subject')}
                onChange={(e) => set({ subject: e.target.value })}
              />
            </FormField>
            <FormField label="Message (HTML)" required error={errors.html} hint={'Paragraphs, links, bold and lists. A link with class="button" becomes a brand-coloured button. Values are escaped; scripts and forms are removed.'}>
              <Textarea
                ref={bodyRef}
                value={draft.html}
                rows={16}
                spellCheck={false}
                disabled={!!readOnlyReason}
                onFocus={() => (lastField.current = 'html')}
                onChange={(e) => set({ html: e.target.value })}
                className="font-mono text-xs leading-relaxed"
              />
            </FormField>
            {problems.unsafeMarkup && (
              <InlineAlert tone="warning" title="Some markup will be removed">
                Scripts, forms, embedded frames, event handlers and javascript links are not allowed in e-mails. They are stripped when you save; the preview already shows the result.
              </InlineAlert>
            )}
            {!errors.html && blocking && (
              <InlineAlert tone="warning" title="Check the variables">
                {problems.unknownVariables.length > 0 && <span className="block">{`Unknown: ${problems.unknownVariables.map((v) => `{{${v}}}`).join(', ')}. They would be empty in the e-mail.`}</span>}
                {problems.missingRequired.length > 0 && <span className="block">{`Missing: ${problems.missingRequired.map((v) => `{{${v}}}`).join(', ')}. The e-mail does not work without it.`}</span>}
              </InlineAlert>
            )}
            <VariablePicker variables={variables} used={used} onInsert={insert} disabled={!!readOnlyReason} />
          </Card>
          <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg border border-border bg-surface-2 px-4 py-3">
            <Button onClick={() => setTestOpen(true)} disabled={blocking || !!readOnlyReason}>
              <Send aria-hidden />
              Send a test
            </Button>
            {customised && !readOnlyReason && (
              <Button variant="ghost" onClick={() => setConfirmReset(true)}>
                <RotateCcw aria-hidden />
                Reset to default
              </Button>
            )}
            <SaveBar dirty={dirty} saving={saving} onDiscard={() => setDraft(initial)} readOnlyReason={readOnlyReason} />
          </div>
        </form>

        <Card className="min-w-0 p-4">
          <EmailPreview subject={draft.subject} html={draft.html} values={sample} variables={variables} brand={brand} fromLine={fromLine} />
        </Card>
      </div>

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Reset to the default?</DialogTitle>
            <DialogDescription>{`${label} goes back to the text Vistar ships. Your version is deleted; this cannot be undone.`}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmReset(false)}>Keep my version</Button>
            <Button variant="danger" loading={resetting} onClick={() => void reset()}>
              Reset to default
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TestSendDialog open={testOpen} onOpenChange={setTestOpen} draft={draft} dirty={dirty} defaultRecipient={defaultRecipient} testing={testing} onTestSend={onTestSend} />
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function TestSendDialog({
  open,
  onOpenChange,
  draft,
  dirty,
  defaultRecipient,
  testing,
  onTestSend,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  draft: EmailTemplateDraft;
  dirty: boolean;
  defaultRecipient?: string;
  testing: boolean;
  onTestSend: EmailTemplateEditorProps['onTestSend'];
}) {
  const [to, setTo] = useState(defaultRecipient ?? '');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TestSendResult | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    setResult(null);
    if (!EMAIL_RE.test(to.trim())) {
      setError('Enter an e-mail address.');
      return;
    }
    setError(null);
    try {
      const r = await onTestSend({ ...draft, to: to.trim() });
      setResult(r);
      if (r.ok) toast.success(r.message);
    } catch (err) {
      setResult({ ok: false, message: formErrorMessage(err, 'The test e-mail was not sent. Check the platform e-mail settings and try again.') });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setResult(null);
      }}
    >
      <DialogContent size="md">
        <form noValidate onSubmit={(e) => void send(e)} className="contents">
          <DialogHeader>
            <DialogTitle>Send a test e-mail</DialogTitle>
            <DialogDescription>{dirty ? 'Sends the text in the editor, including unsaved changes, with sample data.' : 'Sends this template with sample data.'}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <FormField label="Send to" required error={error}>
              <Input type="email" autoComplete="email" value={to} onChange={(e) => setTo(e.target.value)} />
            </FormField>
            {result && (
              <InlineAlert tone={result.ok ? 'info' : 'danger'} title={result.ok ? 'Sent' : 'Not sent'}>
                {result.message}
              </InlineAlert>
            )}
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
            <Button type="submit" variant="primary" loading={testing}>
              <Send aria-hidden />
              Send test
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
