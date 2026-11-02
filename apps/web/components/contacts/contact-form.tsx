'use client';

import { isValidGstin, PAN_RE, panFromGstin, stateCodeFromGstin, type Contact, type ContactUpdate, type CustomFieldValues } from '@vistar/shared';
import { useId, useState } from 'react';
import { Checkbox } from '@/components/leads/primitives/checkbox';
import { toast } from '@/components/ui/toast';
import { FormField, Input } from '@/components/ui/input';
import { useContactMutations } from '@/lib/crm/parties';
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
import { AccountPicker } from '@/lib/crm/ui/pickers';
import type { PickerOption } from '@/lib/crm/ui/record-picker';
import { CoreFieldsInvalid, CrmFormSheet, CrmRecordForm } from '@/lib/crm/ui/record-form';
import { useCan, useMe } from '@/lib/session/session';

interface Draft {
  name: string;
  title: string;
  phone: string;
  email: string;
  account: PickerOption | null;
  city: string;
  gstin: string;
  pan: string;
  ownerId: string | null;
  tags: string[];
  dnd: boolean;
  phones: PointDraft[];
  emails: PointDraft[];
  billing: AddressDraft;
  shipping: AddressDraft;
  shippingSame: boolean;
}

function toDraft(c: Contact | undefined, defaults: { account?: PickerOption | null; ownerId?: string | null }): Draft {
  return {
    name: c?.name ?? '',
    title: c?.title ?? '',
    phone: c?.phone ?? '',
    email: c?.email ?? '',
    account: c?.account ? { id: c.account.id, label: c.account.name } : (defaults.account ?? null),
    city: c?.city ?? '',
    gstin: c?.gstin ?? '',
    pan: c?.pan ?? '',
    ownerId: c ? (c.owner?.id ?? null) : (defaults.ownerId ?? null),
    tags: c?.tags ?? [],
    dnd: c?.dnd ?? false,
    phones: c?.additionalPhones.map((p) => ({ label: p.label, value: p.value })) ?? [],
    emails: c?.additionalEmails.map((p) => ({ label: p.label, value: p.value })) ?? [],
    billing: addressToDraft(c?.billingAddress),
    shipping: addressToDraft(c?.shippingAddress),
    shippingSame: !c?.shippingAddress,
  };
}

/** Create or edit a contact (person): identity, phones and emails, account, tax ids, addresses, owner, tags and custom fields. */
export function ContactFormSheet({
  open,
  onOpenChange,
  contact,
  defaults = {},
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: Contact;
  defaults?: { account?: PickerOption | null; name?: string };
  onSaved?: (c: Contact) => void;
}) {
  const formId = useId().replace(/:/g, '');
  const me = useMe();
  const m = useContactMutations();
  const [draft, setDraft] = useState<Draft>(() => ({ ...toDraft(contact, { account: defaults.account, ownerId: me?.user.id ?? null }), name: contact?.name ?? defaults.name ?? '' }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const canAssign = useCan('leads.assign');
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setFormError(null);
  };
  const submitting = m.create.isPending || m.update.isPending;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!draft.name.trim()) e.name = 'Enter the name.';
    const phone = parsePhone(draft.phone);
    if (phone.error) e.phone = phone.error;
    const email = parseEmail(draft.email);
    if (email.error) e.email = email.error;
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
    return {
      errors: e,
      body: {
        name: draft.name.trim(),
        title: draft.title.trim() || null,
        phone: phone.value,
        email: email.value,
        accountId: draft.account?.id ?? null,
        city: draft.city.trim() || billing.value?.city || null,
        gstin: gstin || null,
        pan: pan || panFromGstin(gstin) || null,
        additionalPhones: phones.values,
        additionalEmails: emails.values,
        billingAddress: billing.value,
        shippingAddress: shipping.value,
        tags: draft.tags,
        dnd: draft.dnd,
        ...(canAssign || !contact ? { ownerId: draft.ownerId } : {}),
      } as ContactUpdate,
    };
  };

  const onSubmit = async (customFields: CustomFieldValues) => {
    const { errors: e, body } = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      setFormError(Object.keys(e).length === 1 ? 'Fix the highlighted field to save.' : `Fix the ${Object.keys(e).length} highlighted fields to save.`);
      focusFirstInvalid(formId);
      throw new CoreFieldsInvalid();
    }
    const saved = contact
      ? await m.update.mutateAsync({ id: contact.id, patch: { ...body, ...(Object.keys(customFields).length ? { customFields } : {}), expectedVersion: contact.version } })
      : await m.create.mutateAsync({ ...body, name: body.name!, customFields } as Parameters<typeof m.create.mutateAsync>[0]);
    toast.success(contact ? 'Contact saved' : `${saved.name} added to contacts`);
    onSaved?.(saved);
    onOpenChange(false);
  };

  const onServerError = (err: unknown) => {
    const e = serverFieldErrors(err);
    setErrors(e);
    setFormError(formErrorMessage(err));
    focusFirstInvalid(formId);
    return true;
  };

  return (
    <CrmFormSheet open={open} onOpenChange={onOpenChange} title={contact ? `Edit ${contact.name}` : 'New contact'} description="People you sell to. Phone numbers are unique in the workspace." formId={formId} submitLabel={contact ? 'Save changes' : 'Add contact'} submitting={submitting}>
      <CrmRecordForm
        formId={formId}
        target="contact"
        mode={contact ? 'update' : 'create'}
        initialCustom={contact?.customFields}
        onSubmit={onSubmit}
        onServerError={onServerError}
        formError={formError}
        core={
          <div className="flex flex-col gap-6">
            <FormSection title="Person">
              <FormGrid>
                <FormField label="Name" required error={errors.name}>
                  <Input value={draft.name} autoComplete="name" onChange={(e) => set({ name: e.target.value })} />
                </FormField>
                <FormField label="Designation" hint="For example Purchase manager">
                  <Input value={draft.title} autoComplete="organization-title" onChange={(e) => set({ title: e.target.value })} />
                </FormField>
                <FormField label="Phone" error={errors.phone} hint="10-digit mobile number">
                  <Input type="tel" inputMode="tel" autoComplete="tel" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} />
                </FormField>
                <FormField label="Email" error={errors.email}>
                  <Input type="email" autoComplete="email" value={draft.email} onChange={(e) => set({ email: e.target.value })} />
                </FormField>
                <FormField label="Account" hint="The company this person works for">
                  <AccountPicker value={draft.account} onChange={(account) => set({ account })} />
                </FormField>
                <FormField label="City">
                  <Input value={draft.city} autoComplete="address-level2" onChange={(e) => set({ city: e.target.value })} />
                </FormField>
                {(canAssign || !contact) && (
                  <FormField label="Owner">
                    <OwnerSelect value={draft.ownerId} onChange={(ownerId) => set({ ownerId })} disabled={!canAssign && !!contact} />
                  </FormField>
                )}
                <div className="flex items-center gap-2 self-end pb-1.5">
                  <Checkbox id={`${formId}-dnd`} checked={draft.dnd} onCheckedChange={(v) => set({ dnd: v === true })} />
                  <label htmlFor={`${formId}-dnd`} className="text-sm text-fg">
                    Do not disturb (no calls or WhatsApp campaigns)
                  </label>
                </div>
              </FormGrid>
              <FormGrid>
                <ContactPointsField kind="phone" value={draft.phones} onChange={(phones) => set({ phones })} errors={indexErrors(errors, 'additionalPhones')} />
                <ContactPointsField kind="email" value={draft.emails} onChange={(emails) => set({ emails })} errors={indexErrors(errors, 'additionalEmails')} />
              </FormGrid>
              <TagsInput value={draft.tags} onChange={(tags) => set({ tags })} />
            </FormSection>
            <FormSection title="Tax details" description="Used on quotations and invoices for this person when there is no account.">
              <FormGrid>
                <FormField label="GSTIN" error={errors.gstin}>
                  <Input value={draft.gstin} maxLength={15} className="uppercase" onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} />
                </FormField>
                <FormField label="PAN" error={errors.pan} hint="Filled from the GSTIN when empty">
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

export function indexErrors(errors: Record<string, string>, prefix: string): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [k, v] of Object.entries(errors)) {
    const m = new RegExp(`^${prefix}\\.(\\d+)`).exec(k);
    if (m) out[Number(m[1])] = v;
  }
  return out;
}
