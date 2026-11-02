'use client';

import { isValidGstin, PAN_RE, panFromGstin, stateCodeFromGstin, type Account, type AccountUpdate, type CustomFieldValues } from '@vistar/shared';
import { useId, useState } from 'react';
import { Checkbox } from '@/components/leads/primitives/checkbox';
import { toast } from '@/components/ui/toast';
import { FormField, Input } from '@/components/ui/input';
import { indexErrors } from '@/components/contacts/contact-form';
import { useAccountMutations } from '@/lib/crm/parties';
import { formErrorMessage, focusFirstInvalid, nestedErrors, serverFieldErrors } from '@/lib/crm/ui/errors';
import {
  AddressFields,
  addressToDraft,
  ContactPointsField,
  draftToAddress,
  emptyAddress,
  FormGrid,
  FormSection,
  OwnerSelect,
  parseEmail,
  parsePhone,
  pointsProblems,
  TagsInput,
  type AddressDraft,
  type PointDraft,
} from '@/lib/crm/ui/fields';
import { CoreFieldsInvalid, CrmFormSheet, CrmRecordForm } from '@/lib/crm/ui/record-form';
import { useCan, useMe } from '@/lib/session/session';

interface Draft {
  name: string;
  industry: string;
  website: string;
  phone: string;
  email: string;
  gstin: string;
  pan: string;
  ownerId: string | null;
  tags: string[];
  phones: PointDraft[];
  emails: PointDraft[];
  billing: AddressDraft;
  shipping: AddressDraft;
  shippingSame: boolean;
}

function toDraft(a: Account | undefined, ownerId: string | null, name = ''): Draft {
  return {
    name: a?.name ?? name,
    industry: a?.industry ?? '',
    website: a?.website ?? '',
    phone: a?.phone ?? '',
    email: a?.email ?? '',
    gstin: a?.gstin ?? '',
    pan: a?.pan ?? '',
    ownerId: a ? (a.owner?.id ?? null) : ownerId,
    tags: a?.tags ?? [],
    phones: a?.additionalPhones.map((p) => ({ label: p.label, value: p.value })) ?? [],
    emails: a?.additionalEmails.map((p) => ({ label: p.label, value: p.value })) ?? [],
    billing: addressToDraft(a?.billingAddress),
    shipping: addressToDraft(a?.shippingAddress),
    shippingSame: !a?.shippingAddress,
  };
}

function normaliseUrl(input: string): { value: string | null; error: string | null } {
  const v = input.trim();
  if (!v) return { value: null, error: null };
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes('.')) throw new Error('host');
    return { value: u.toString(), error: null };
  } catch {
    return { value: null, error: 'Enter a website like www.company.com.' };
  }
}

/** Create or edit an account (company): GSTIN and PAN, addresses with state codes, contact points, owner, tags, custom fields. */
export function AccountFormSheet({ open, onOpenChange, account, defaultName, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; account?: Account; defaultName?: string; onSaved?: (a: Account) => void }) {
  const formId = useId().replace(/:/g, '');
  const me = useMe();
  const m = useAccountMutations();
  const canAssign = useCan('leads.assign');
  const [draft, setDraft] = useState<Draft>(() => toDraft(account, me?.user.id ?? null, defaultName));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setFormError(null);
  };

  const onGstin = (value: string) => {
    const g = value.toUpperCase();
    const patch: Partial<Draft> = { gstin: g };
    // Fill the billing state from a valid GSTIN when it is still empty.
    if (isValidGstin(g) && !draft.billing.stateCode) patch.billing = { ...draft.billing, stateCode: stateCodeFromGstin(g) };
    set(patch);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!draft.name.trim()) e.name = 'Enter the account name.';
    const phone = parsePhone(draft.phone);
    if (phone.error) e.phone = phone.error;
    const email = parseEmail(draft.email);
    if (email.error) e.email = email.error;
    const website = normaliseUrl(draft.website);
    if (website.error) e.website = website.error;
    const gstin = draft.gstin.trim().toUpperCase();
    if (gstin && !isValidGstin(gstin)) e.gstin = 'Enter a valid 15-character GSTIN (the last character is a check digit).';
    const pan = draft.pan.trim().toUpperCase();
    if (pan && !PAN_RE.test(pan)) e.pan = 'Enter a valid 10-character PAN, e.g. ABCDE1234F.';
    const phones = pointsProblems('phone', draft.phones);
    const emails = pointsProblems('email', draft.emails);
    Object.entries(phones.errors).forEach(([i, msg]) => (e[`additionalPhones.${i}`] = msg));
    Object.entries(emails.errors).forEach(([i, msg]) => (e[`additionalEmails.${i}`] = msg));
    const billing = draftToAddress(draft.billing);
    Object.entries(billing.errors).forEach(([k, msg]) => (e[`billingAddress.${k}`] = msg));
    const shipping = draft.shippingSame ? { value: null, errors: {} } : draftToAddress(draft.shipping);
    Object.entries(shipping.errors).forEach(([k, msg]) => (e[`shippingAddress.${k}`] = msg));
    if (gstin && isValidGstin(gstin) && billing.value?.stateCode && stateCodeFromGstin(gstin) !== billing.value.stateCode) e['billingAddress.stateCode'] = 'The billing state must match the GSTIN state.';
    const body: AccountUpdate = {
      name: draft.name.trim(),
      industry: draft.industry.trim() || null,
      website: website.value,
      phone: phone.value,
      email: email.value,
      gstin: gstin || null,
      pan: pan || panFromGstin(gstin) || null,
      additionalPhones: phones.values as AccountUpdate['additionalPhones'],
      additionalEmails: emails.values as AccountUpdate['additionalEmails'],
      billingAddress: billing.value,
      shippingAddress: shipping.value,
      tags: draft.tags,
      ...(canAssign || !account ? { ownerId: draft.ownerId } : {}),
    };
    return { errors: e, body };
  };

  const onSubmit = async (customFields: CustomFieldValues) => {
    const { errors: e, body } = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      setFormError(Object.keys(e).length === 1 ? 'Fix the highlighted field to save.' : `Fix the ${Object.keys(e).length} highlighted fields to save.`);
      focusFirstInvalid(formId);
      throw new CoreFieldsInvalid();
    }
    const saved = account
      ? await m.update.mutateAsync({ id: account.id, patch: { ...body, ...(Object.keys(customFields).length ? { customFields } : {}), expectedVersion: account.version } })
      : await m.create.mutateAsync({ ...body, name: body.name!, customFields } as Parameters<typeof m.create.mutateAsync>[0]);
    toast.success(account ? 'Account saved' : `${saved.name} added to accounts`);
    onSaved?.(saved);
    onOpenChange(false);
  };

  const onServerError = (err: unknown) => {
    setErrors(serverFieldErrors(err));
    setFormError(formErrorMessage(err));
    focusFirstInvalid(formId);
    return true;
  };

  return (
    <CrmFormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={account ? `Edit ${account.name}` : 'New account'}
      description="Companies you sell to. The GSTIN and billing state decide the GST on quotations and invoices."
      formId={formId}
      submitLabel={account ? 'Save changes' : 'Add account'}
      submitting={m.create.isPending || m.update.isPending}
    >
      <CrmRecordForm
        formId={formId}
        target="company"
        mode={account ? 'update' : 'create'}
        initialCustom={account?.customFields}
        onSubmit={onSubmit}
        onServerError={onServerError}
        formError={formError}
        core={
          <div className="flex flex-col gap-6">
            <FormSection title="Company">
              <FormGrid>
                <FormField label="Account name" required error={errors.name}>
                  <Input value={draft.name} autoComplete="organization" onChange={(e) => set({ name: e.target.value })} />
                </FormField>
                <FormField label="Industry">
                  <Input value={draft.industry} onChange={(e) => set({ industry: e.target.value })} />
                </FormField>
                <FormField label="Phone" error={errors.phone}>
                  <Input type="tel" inputMode="tel" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} />
                </FormField>
                <FormField label="Email" error={errors.email}>
                  <Input type="email" value={draft.email} onChange={(e) => set({ email: e.target.value })} />
                </FormField>
                <FormField label="Website" error={errors.website}>
                  <Input value={draft.website} inputMode="url" placeholder="www.company.com" onChange={(e) => set({ website: e.target.value })} />
                </FormField>
                {(canAssign || !account) && (
                  <FormField label="Owner">
                    <OwnerSelect value={draft.ownerId} onChange={(ownerId) => set({ ownerId })} disabled={!canAssign && !!account} />
                  </FormField>
                )}
              </FormGrid>
              <FormGrid>
                <ContactPointsField kind="phone" value={draft.phones} onChange={(phones) => set({ phones })} errors={indexErrors(errors, 'additionalPhones')} />
                <ContactPointsField kind="email" value={draft.emails} onChange={(emails) => set({ emails })} errors={indexErrors(errors, 'additionalEmails')} />
              </FormGrid>
              <TagsInput value={draft.tags} onChange={(tags) => set({ tags })} />
            </FormSection>
            <FormSection title="Tax details">
              <FormGrid>
                <FormField label="GSTIN" error={errors.gstin} hint="Fills the billing state when it is empty">
                  <Input value={draft.gstin} maxLength={15} className="uppercase" onChange={(e) => onGstin(e.target.value)} />
                </FormField>
                <FormField label="PAN" error={errors.pan} hint="Taken from the GSTIN when empty">
                  <Input value={draft.pan} maxLength={10} className="uppercase" onChange={(e) => set({ pan: e.target.value.toUpperCase() })} />
                </FormField>
              </FormGrid>
            </FormSection>
            <AddressFields legend="Billing address" value={draft.billing} onChange={(billing) => set({ billing })} errors={nestedErrors(errors, 'billingAddress')} />
            <div className="flex items-center gap-2">
              <Checkbox id={`${formId}-same`} checked={draft.shippingSame} onCheckedChange={(v) => set({ shippingSame: v === true, shipping: v === true ? emptyAddress() : draft.billing })} />
              <label htmlFor={`${formId}-same`} className="text-sm text-fg">
                Shipping address is the same as billing
              </label>
            </div>
            {!draft.shippingSame && <AddressFields legend="Shipping address" value={draft.shipping} onChange={(shipping) => set({ shipping })} errors={nestedErrors(errors, 'shippingAddress')} />}
          </div>
        }
      />
    </CrmFormSheet>
  );
}
