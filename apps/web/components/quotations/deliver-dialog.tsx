'use client';

import type { DocumentDeliver, DocumentDeliveryResult } from '@vistar/shared';
import { CheckCircle2, Copy, Mail, MessageCircle, Send, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { CheckboxRow } from '@/components/settings/common/checkbox';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { useWhatsAppTemplates } from '@/lib/config/company';
import { useInvoiceMutations, useQuotationMutations } from '@/lib/crm/documents';
import { formErrorMessage } from '@/lib/crm/ui/errors';

type Channel = DocumentDeliver['channel'];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 10;
const VIA: Record<DocumentDeliveryResult['via'], string> = {
  company_smtp: 'your company mailbox',
  platform_mailer: 'the platform e-mail service',
  whatsapp_cloud: 'WhatsApp Business',
  mock: 'test mode (nothing was sent)',
};

/** "a@x.in, b@y.in; c@z.in" -> unique lower-case addresses and the invalid parts. */
export function parseEmails(raw: string): { list: string[]; invalid: string[] } {
  const parts = raw.split(/[\s,;]+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
  const list = [...new Set(parts.filter((p) => EMAIL.test(p)))];
  return { list, invalid: parts.filter((p) => !EMAIL.test(p)) };
}

/**
 * Send a quotation or an invoice to the customer (change #20): by e-mail with the PDF attached (the company's
 * Quotation sent / Invoice sent template, from the company mailbox or the platform e-mail service) or on
 * WhatsApp with the share link (an approved template; automatic picks one named document_share). A draft is
 * marked sent (quotation) or issued (invoice) first, and the delivery is recorded on the lead timeline.
 */
export function DeliverDialog({
  kind,
  doc,
  onClose,
}: {
  kind: 'quotation' | 'invoice';
  doc: { id: string; number: string | null; buyer: { name: string; email: string | null; phone: string | null } };
  onClose: () => void;
}) {
  const qm = useQuotationMutations();
  const im = useInvoiceMutations();
  const mutation = kind === 'quotation' ? qm.deliver : im.deliver;
  const what = kind === 'quotation' ? 'Quotation' : 'Invoice';
  const title = `${what} ${doc.number ?? '(draft)'}`;
  const ids = useId();

  const [channel, setChannel] = useState<Channel>(doc.buyer.email || !doc.buyer.phone ? 'email' : 'whatsapp');
  const [to, setTo] = useState(doc.buyer.email ?? '');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [attachPdf, setAttachPdf] = useState(true);
  const [phone, setPhone] = useState(doc.buyer.phone ?? '');
  const [templateId, setTemplateId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<DocumentDeliveryResult | null>(null);

  const submit = () => {
    const next: Record<string, string> = {};
    let body: DocumentDeliver;
    if (channel === 'email') {
      const t = parseEmails(to);
      const c = parseEmails(cc);
      if (!t.list.length) next.to = 'Enter at least one e-mail address';
      else if (t.invalid.length) next.to = `Not an e-mail address: ${t.invalid.join(', ')}`;
      else if (t.list.length > MAX_RECIPIENTS) next.to = `At most ${MAX_RECIPIENTS} recipients`;
      if (c.invalid.length) next.cc = `Not an e-mail address: ${c.invalid.join(', ')}`;
      else if (c.list.length > MAX_RECIPIENTS) next.cc = `At most ${MAX_RECIPIENTS} addresses in copy`;
      body = { channel: 'email', to: t.list, cc: c.list, subject: subject.trim() || undefined, message: message.trim() || undefined, attachPdf, expiresInDays: 30 };
    } else {
      const p = phone.trim();
      if (p && !/^\+?[\d\s-]{8,16}$/.test(p)) next.phone = 'Enter the number with the country code, for example +91 98765 43210';
      body = { channel: 'whatsapp', to: p ? p.replace(/[\s-]/g, '') : undefined, templateId: templateId || undefined, expiresInDays: 30 };
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    mutation.mutate(
      { id: doc.id, body },
      {
        onSuccess: (r) => {
          setResult(r);
          if (r.status === 'failed') toast.error(r.error ?? `${what} could not be sent`);
          else toast.success(r.via === 'mock' ? `${title}: test mode, nothing was sent` : `${title} sent to ${r.to.join(', ')}`);
        },
        onError: (e) => toast.error(formErrorMessage(e, `${what} was not sent. Try again.`)),
      },
    );
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Link copied');
    } catch {
      toast.error('Copy did not work in this browser. Select the link and copy it.');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{`Send ${title}`}</DialogTitle>
          <DialogDescription>{`To ${doc.buyer.name}. ${kind === 'quotation' ? 'A draft is marked as sent' : 'A draft is issued with the next number'} and a fresh share link is created (the previous link stops working).`}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {result ? (
            <DeliveryResult result={result} onCopy={(t) => void copy(t)} />
          ) : (
            <div className="flex flex-col gap-4">
              <div role="radiogroup" aria-label="Send by" className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: 'email', label: 'E-mail', hint: 'PDF attached', icon: Mail },
                    { id: 'whatsapp', label: 'WhatsApp', hint: 'Link in a template', icon: MessageCircle },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={channel === o.id}
                    onClick={() => setChannel(o.id)}
                    className={cn(
                      'focus-ring flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-150 ease-standard',
                      channel === o.id ? 'border-accent bg-accent-soft text-fg' : 'border-border bg-surface text-fg-secondary hover:bg-surface-2',
                    )}
                  >
                    <o.icon aria-hidden className="size-5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{o.label}</span>
                      <span className="block text-xs text-muted-strong">{o.hint}</span>
                    </span>
                  </button>
                ))}
              </div>

              {channel === 'email' ? (
                <form id={`${ids}-email`} className="flex flex-col gap-3" onSubmit={(e) => (e.preventDefault(), submit())} noValidate>
                  <FormField label="To" required error={errors.to} hint="Separate addresses with commas.">
                    <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com" autoComplete="off" />
                  </FormField>
                  <FormField label="Copy to" error={errors.cc}>
                    <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Optional" autoComplete="off" />
                  </FormField>
                  <FormField label="Subject" hint="Leave empty to use your e-mail template.">
                    <Input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} placeholder={`${title} from your company`} />
                  </FormField>
                  <FormField label="Personal message" hint="Shown under the greeting in the e-mail.">
                    <Textarea rows={3} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="As discussed on the phone, here is our best price." />
                  </FormField>
                  <CheckboxRow checked={attachPdf} onCheckedChange={(v) => setAttachPdf(v === true)} label="Attach the PDF" />
                  <p className="text-xs text-muted-strong">
                    {'Sent from your company mailbox when it is connected in '}
                    <Link className="text-accent-text underline-offset-4 hover:underline" href="/app/integrations">
                      Integrations
                    </Link>
                    {', else from the platform e-mail service with your company name. Edit the text in '}
                    <Link className="text-accent-text underline-offset-4 hover:underline" href="/app/settings/email-templates">
                      Settings, E-mail templates
                    </Link>
                    .
                  </p>
                </form>
              ) : (
                <form id={`${ids}-wa`} className="flex flex-col gap-3" onSubmit={(e) => (e.preventDefault(), submit())} noValidate>
                  <FormField label="WhatsApp number" error={errors.phone} hint={doc.buyer.phone ? 'The customer number on the document.' : 'Leave empty to use the contact or lead number.'}>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" inputMode="tel" autoComplete="off" />
                  </FormField>
                  <TemplatePicker value={templateId} onChange={setTemplateId} />
                </form>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {result ? (
            <DialogClose asChild>
              <Button variant="primary">Done</Button>
            </DialogClose>
          ) : (
            <>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button variant="primary" loading={mutation.isPending} onClick={submit}>
                <Send aria-hidden />
                {channel === 'email' ? 'Send e-mail' : 'Send on WhatsApp'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Approved WhatsApp templates (Settings, WhatsApp templates); automatic = the one named document_share. */
function TemplatePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const q = useWhatsAppTemplates();
  const approved = useMemo(() => (q.data ?? []).filter((t) => t.status === 'approved'), [q.data]);
  const hasDefault = approved.some((t) => ['document_share', 'quotation_share', 'invoice_share', 'quotation_sent', 'invoice_sent'].includes(t.name));
  return (
    <div className="flex flex-col gap-2">
      <FormField label="Template" hint="WhatsApp only allows approved templates for the first message to a customer.">
        <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} disabled={q.isPending}>
          <option value="">{q.isPending ? 'Loading templates' : 'Automatic (document_share)'}</option>
          {approved.map((t) => (
            <option key={t.id} value={t.id}>{`${t.name} (${t.language})`}</option>
          ))}
        </NativeSelect>
      </FormField>
      {q.isError && <p className="text-xs text-danger-text">{formErrorMessage(q.error, 'The templates did not load.')}</p>}
      {q.isSuccess && !hasDefault && !value && (
        <p className="text-xs text-warning-text">
          {'No approved template named document_share yet. Pick one above, or create it in '}
          <Link className="underline-offset-4 hover:underline" href="/app/settings/whatsapp-templates">
            Settings, WhatsApp templates
          </Link>
          {' with {{1}} name, {{2}} document number, {{3}} link and {{4}} amount.'}
        </p>
      )}
    </div>
  );
}

function DeliveryResult({ result: r, onCopy }: { result: DocumentDeliveryResult; onCopy: (text: string) => void }) {
  const failed = r.status === 'failed';
  return (
    <div className="flex flex-col gap-3" role="status">
      <div className={cn('flex items-start gap-3 rounded-lg border p-3', failed ? 'border-status-red-border bg-status-red-bg' : 'border-status-green-border bg-status-green-bg')}>
        {failed ? <XCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-danger-text" /> : <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-success-text" />}
        <div className="min-w-0 text-sm">
          <p className="font-medium text-fg">{failed ? 'Not sent' : r.status === 'queued' ? 'Queued' : 'Sent'}</p>
          <p className="text-fg-secondary">{failed ? (r.error ?? 'The provider refused the message.') : `To ${r.to.join(', ')} through ${VIA[r.via]}.`}</p>
        </div>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-secondary">Share link</span>
        <span className="flex gap-1.5">
          <Input readOnly value={r.share.url} onFocus={(e) => e.currentTarget.select()} />
          <Button size="icon" aria-label="Copy link" onClick={() => onCopy(r.share.url)}>
            <Copy aria-hidden />
          </Button>
        </span>
      </label>
      {r.conversationId && (
        <Button asChild variant="link" className="self-start">
          <Link href={`/app/inbox?c=${r.conversationId}`}>Open the WhatsApp conversation</Link>
        </Button>
      )}
    </div>
  );
}
