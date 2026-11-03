'use client';

import { GstinSchema, InrSchema, type Lead, type RouteBody, type RouteResponse } from '@vistar/shared';
import { Building2, Contact, Handshake } from 'lucide-react';
import Link from 'next/link';
import { RadioGroup } from 'radix-ui';
import { useId, useState, type ReactNode } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Switch } from '@/components/common/switch';
import { InlineAlert } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { useDealMutations, useDealPipelines } from '@/lib/crm/deals';
import { useAccount, useContact } from '@/lib/crm/parties';
import { formErrorMessage, focusFirstInvalid, serverFieldErrors } from '@/lib/crm/ui/errors';
import { AccountPicker, ContactPicker } from '@/lib/crm/ui/pickers';
import type { PickerOption } from '@/lib/crm/ui/record-picker';
import { useCan } from '@/lib/session/session';

type ContactMode = 'keep' | 'create' | 'existing';
type AccountMode = 'keep' | 'create' | 'existing' | 'none';
type ConvertResult = RouteResponse<'leadConvert'>;

/** Whether the lead detail may offer "Convert to deal" (POST /leads/{id}/convert needs leads.update). */
export function useCanConvertLead(lead: Pick<Lead, 'contactId'>): boolean {
  const canUpdate = useCan('leads.update');
  const canDeal = useCan('deals.create');
  const canContact = useCan('contacts.create');
  const canPickContact = useCan('contacts.read');
  return canUpdate && (canDeal || canContact || canPickContact || !!lead.contactId);
}

/** Default deal title, the same rule as the API (company or name, plus the product interest). */
export const defaultDealTitle = (lead: Pick<Lead, 'companyName' | 'name' | 'productInterest'>) =>
  `${lead.companyName ?? lead.name}${lead.productInterest ? ` - ${lead.productInterest}` : ''}`.slice(0, 160);

const rupees = (s: string) => s.replace(/[,\s₹]/g, '');

/**
 * "Convert to deal" (SPEC 29.9): link or create the contact, link or create the account (default: from
 * the lead's company name), and optionally a deal with stage and value. The lead stays open and keeps
 * its timeline; the result lists the records with links (when the company panel is reachable).
 */
export function ConvertLeadDialog({
  lead,
  open,
  onOpenChange,
  linkable,
}: {
  lead: Lead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Links to /app/contacts, /app/accounts and /app/deals work for this user (company panel). */
  linkable: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        {open && <ConvertBody lead={lead} linkable={linkable} />}
      </DialogContent>
    </Dialog>
  );
}

function ConvertBody({ lead, linkable }: { lead: Lead; linkable: boolean }) {
  const formId = `convert-${useId().replace(/:/g, '')}`;
  const canContactCreate = useCan('contacts.create');
  const canContactRead = useCan('contacts.read');
  const canAccountCreate = useCan('accounts.create');
  const canAccountRead = useCan('accounts.read');
  const canDeal = useCan('deals.create');
  const linkedContact = useContact(lead.contactId);
  const linkedAccount = useAccount(lead.companyId);
  const m = useDealMutations().convertLead;

  const [contactMode, setContactMode] = useState<ContactMode>(lead.contactId ? 'keep' : canContactCreate ? 'create' : 'existing');
  const [contact, setContact] = useState<PickerOption | null>(null);
  const [accountMode, setAccountMode] = useState<AccountMode>(
    lead.companyId ? 'keep' : lead.companyName && canAccountCreate ? 'create' : 'none',
  );
  const [account, setAccount] = useState<PickerOption | null>(null);
  const [accountName, setAccountName] = useState(lead.companyName ?? '');
  const [gstin, setGstin] = useState('');
  const [withDeal, setWithDeal] = useState(canDeal);
  const [title, setTitle] = useState(() => defaultDealTitle(lead));
  const [stageId, setStageId] = useState('');
  const [value, setValue] = useState(lead.valueInr ? String(lead.valueInr) : '');
  const [closeOn, setCloseOn] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);

  if (result) return <ConvertResultView lead={lead} result={result} linkable={linkable} />;

  const contactOptions: Array<{ value: ContactMode; label: string; hint?: string; disabled?: boolean }> = lead.contactId
    ? [
        { value: 'keep', label: `Keep the linked contact${linkedContact.data ? `: ${linkedContact.data.name}` : ''}` },
        { value: 'existing', label: 'Link another contact', disabled: !canContactRead },
      ]
    : [
        { value: 'create', label: `Create a contact from this lead (${lead.name})`, hint: 'Name, phone, email and city are copied.', disabled: !canContactCreate },
        { value: 'existing', label: 'Link an existing contact', disabled: !canContactRead },
      ];
  const accountOptions: Array<{ value: AccountMode; label: string; hint?: string; disabled?: boolean }> = [
    ...(lead.companyId
      ? [{ value: 'keep' as const, label: `Keep the linked account${linkedAccount.data ? `: ${linkedAccount.data.name}` : ''}` }]
      : [
          {
            value: 'create' as const,
            label: lead.companyName ? `Create an account for ${lead.companyName}` : 'Create an account',
            hint: 'An account with the same name is reused instead of creating a second one.',
            disabled: !canAccountCreate,
          },
        ]),
    { value: 'existing', label: 'Link an existing account', disabled: !canAccountRead },
    ...(lead.companyId ? [] : [{ value: 'none' as const, label: 'No account (a person buying for themselves)' }]),
  ];

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (contactMode === 'existing' && !contact) e.contactId = 'Pick the contact to link.';
    if (accountMode === 'existing' && !account) e.accountId = 'Pick the account to link.';
    if (accountMode === 'create') {
      if (!accountName.trim()) e.accountName = 'Enter the account name.';
      if (gstin.trim() && !GstinSchema.safeParse(gstin).success) e.gstin = 'Enter a valid 15-character GSTIN, for example 27AAPFU0939F1ZV.';
    }
    if (withDeal) {
      if (!title.trim()) e.title = 'Enter a deal title.';
      const v = rupees(value);
      if (v && !(/^\d+$/.test(v) && InrSchema.safeParse(Number(v)).success)) e.valueInr = 'Enter the value in whole rupees.';
    }
    return e;
  };

  const submit = async () => {
    const e = validate();
    setErrors(e);
    setFormError(null);
    if (Object.keys(e).length) {
      setFormError(Object.keys(e).length === 1 ? 'Fix the highlighted field to convert.' : `Fix the ${Object.keys(e).length} highlighted fields to convert.`);
      focusFirstInvalid(formId);
      return;
    }
    const body: RouteBody<'leadConvert'> = {
      ...(contactMode === 'existing' && contact ? { contactId: contact.id } : {}),
      ...(accountMode === 'none'
        ? { account: { mode: 'none' as const } }
        : accountMode === 'existing' && account
          ? { account: { mode: 'existing' as const, accountId: account.id } }
          : accountMode === 'create'
            ? { account: { mode: 'create' as const, name: accountName.trim(), gstin: gstin.trim() ? gstin.trim().toUpperCase() : null } }
            : {}),
      deal: withDeal
        ? {
            title: title.trim(),
            ...(stageId ? { stageId } : {}),
            ...(rupees(value) ? { valueInr: Number(rupees(value)) } : {}),
            expectedCloseAt: closeOn ? new Date(`${closeOn}T12:00:00+05:30`).toISOString() : null,
          }
        : null,
    };
    try {
      setResult(await m.mutateAsync({ leadId: lead.id, body }));
    } catch (err) {
      const fields = serverFieldErrors(err);
      setErrors({
        ...(fields.contactId ? { contactId: fields.contactId } : {}),
        ...(fields['account.accountId'] ? { accountId: fields['account.accountId'] } : {}),
        ...(fields['account.name'] ? { accountName: fields['account.name'] } : {}),
        ...(fields['account.gstin'] ? { gstin: fields['account.gstin'] } : {}),
        ...(fields['deal.title'] ? { title: fields['deal.title'] } : {}),
        ...(fields['deal.valueInr'] ? { valueInr: fields['deal.valueInr'] } : {}),
        ...(fields['deal.stageId'] ? { stageId: fields['deal.stageId'] } : {}),
      });
      setFormError(formErrorMessage(err, `${lead.name} was not converted. Check your connection and try again.`));
      focusFirstInvalid(formId);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Convert {lead.name} to a deal</DialogTitle>
        <DialogDescription>
          The lead stays in the pipeline with its timeline. It gets linked to the contact and account, and the deal tracks the sale.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <form
          id={formId}
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {formError && <InlineAlert>{formError}</InlineAlert>}

          <Fieldset icon={<Contact aria-hidden />} legend="Contact">
            <Choices label="Contact" value={contactMode} onChange={(v) => setContactMode(v as ContactMode)} options={contactOptions} />
            {contactMode === 'existing' && (
              <FormField label="Contact to link" required error={errors.contactId}>
                <ContactPicker accountId={accountMode === 'existing' ? account?.id : undefined} value={contact} onChange={setContact} invalid={!!errors.contactId} />
              </FormField>
            )}
          </Fieldset>

          <Fieldset icon={<Building2 aria-hidden />} legend="Account">
            <Choices label="Account" value={accountMode} onChange={(v) => setAccountMode(v as AccountMode)} options={accountOptions} />
            {accountMode === 'existing' && (
              <FormField label="Account to link" required error={errors.accountId}>
                <AccountPicker value={account} onChange={setAccount} invalid={!!errors.accountId} />
              </FormField>
            )}
            {accountMode === 'create' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Account name" required error={errors.accountName}>
                  <Input value={accountName} maxLength={160} onChange={(e) => setAccountName(e.target.value)} />
                </FormField>
                <FormField label="GSTIN" hint="Optional. Needed for GST invoices to this buyer." error={errors.gstin}>
                  <Input value={gstin} maxLength={15} autoCapitalize="characters" className="font-mono uppercase" onChange={(e) => setGstin(e.target.value)} />
                </FormField>
              </div>
            )}
          </Fieldset>

          <Fieldset icon={<Handshake aria-hidden />} legend="Deal">
            <label className={cn('flex items-center gap-3 text-sm', !canDeal && 'opacity-60')}>
              <Switch checked={withDeal} disabled={!canDeal} onCheckedChange={setWithDeal} aria-describedby={canDeal ? undefined : `${formId}-nodeal`} />
              <span>Create a deal</span>
            </label>
            {!canDeal && (
              <p id={`${formId}-nodeal`} className="text-xs text-muted">
                Your role cannot create deals. The contact and account are still linked.
              </p>
            )}
            {withDeal && <DealFields title={title} setTitle={setTitle} stageId={stageId} setStageId={setStageId} value={value} setValue={setValue} closeOn={closeOn} setCloseOn={setCloseOn} errors={errors} />}
          </Fieldset>
        </form>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button>Cancel</Button>
        </DialogClose>
        <Button type="submit" form={formId} variant="primary" loading={m.isPending}>
          <Handshake aria-hidden />
          {withDeal ? 'Convert to deal' : 'Link contact and account'}
        </Button>
      </DialogFooter>
    </>
  );
}

function DealFields({
  title,
  setTitle,
  stageId,
  setStageId,
  value,
  setValue,
  closeOn,
  setCloseOn,
  errors,
}: {
  title: string;
  setTitle: (v: string) => void;
  stageId: string;
  setStageId: (v: string) => void;
  value: string;
  setValue: (v: string) => void;
  closeOn: string;
  setCloseOn: (v: string) => void;
  errors: Record<string, string>;
}) {
  const pipelines = useDealPipelines();
  const items = pipelines.data?.items ?? [];
  const fallback = (items.find((p) => p.isDefault) ?? items[0])?.stages.find((s) => s.type === 'open');
  const selected = stageId || fallback?.id || '';
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label="Deal title" required error={errors.title} className="sm:col-span-2">
        <Input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
      </FormField>
      <FormField label="Stage" error={errors.stageId} hint={pipelines.isError ? 'Stages did not load; the first open stage is used.' : undefined}>
        <NativeSelect value={selected} disabled={!items.length} onChange={(e) => setStageId(e.target.value)}>
          {items.length === 0 && <option value="">{pipelines.isPending ? 'Loading stages…' : 'First open stage'}</option>}
          {items.length === 1
            ? items[0]!.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))
            : items.map((p) => (
                <optgroup key={p.id} label={p.name}>
                  {p.stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
        </NativeSelect>
      </FormField>
      <FormField label="Value (₹, before GST)" error={errors.valueInr} hint="Whole rupees. Empty = the lead's deal value.">
        <Input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
      </FormField>
      <FormField label="Expected close" hint="Optional">
        <Input type="date" value={closeOn} onChange={(e) => setCloseOn(e.target.value)} />
      </FormField>
    </div>
  );
}

function ConvertResultView({ lead, result, linkable }: { lead: Lead; result: ConvertResult; linkable: boolean }) {
  const rows: Array<{ key: string; icon: ReactNode; kind: string; name: string; href: string }> = [
    { key: 'contact', icon: <Contact aria-hidden />, kind: 'Contact', name: result.contact.name, href: `/app/contacts/${result.contact.id}` },
    ...(result.account ? [{ key: 'account', icon: <Building2 aria-hidden />, kind: 'Account', name: result.account.name, href: `/app/accounts/${result.account.id}` }] : []),
    ...(result.deal ? [{ key: 'deal', icon: <Handshake aria-hidden />, kind: 'Deal', name: result.deal.title, href: `/app/deals/${result.deal.id}` }] : []),
  ];
  return (
    <>
      <DialogHeader>
        <DialogTitle>{lead.name} converted</DialogTitle>
        <DialogDescription>{result.deal ? 'The deal is in the Deals pipeline. ' : ''}The lead now links to these records.</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <ul role="status" aria-label="Converted records" className="flex flex-col divide-y divide-border rounded-md border border-border">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-3 px-3 py-2.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted">
              {r.icon}
              <span className="w-20 shrink-0 text-xs font-medium text-muted-strong">{r.kind}</span>
              {linkable ? (
                <Link href={r.href} className="focus-ring min-w-0 truncate rounded-xs text-sm font-medium text-accent-text underline-offset-4 hover:underline">
                  {r.name}
                </Link>
              ) : (
                <span className="min-w-0 truncate text-sm font-medium">{r.name}</span>
              )}
            </li>
          ))}
        </ul>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button>Done</Button>
        </DialogClose>
        {linkable && result.deal && (
          <Button variant="primary" asChild>
            <Link href={`/app/deals/${result.deal.id}`}>Open the deal</Link>
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

function Fieldset({ icon, legend, children }: { icon: ReactNode; legend: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
      <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold text-fg [&>svg]:size-4 [&>svg]:text-muted">
        {icon}
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}

function Choices({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string; hint?: string; disabled?: boolean }>;
}) {
  return (
    <RadioGroup.Root value={value} onValueChange={onChange} aria-label={label} className="flex flex-col gap-1.5" loop>
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          className={cn(
            'focus-ring flex items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
            o.value === value ? 'border-status-indigo-border bg-accent-soft' : 'border-border hover:bg-surface-2',
          )}
        >
          <span
            aria-hidden
            className={cn('mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border', o.value === value ? 'border-accent' : 'border-input')}
          >
            <RadioGroup.Indicator className="size-2 rounded-full bg-accent" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={cn('text-sm font-medium', o.value === value ? 'text-accent-soft-fg' : 'text-fg')}>{o.label}</span>
            {o.hint && <span className="text-xs text-muted-strong">{o.hint}</span>}
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
