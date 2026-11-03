'use client';

import { GstinSchema, type BillingContact } from '@vistar/shared';
import { Pencil } from 'lucide-react';
import { useId, useState } from 'react';
import { InlineAlert } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useBillingMutations } from '@/lib/billing/hooks';
import { formErrorMessage, focusFirstInvalid, nestedErrors, serverFieldErrors } from '@/lib/crm/ui/errors';
import { addressToDraft, AddressFields, draftToAddress, formatAddress, FormGrid, parseEmail, parsePhone, type AddressDraft } from '@/lib/crm/ui/fields';

/**
 * Who Vistar bills (printed on Vistar's invoices): legal name, email, phone, GSTIN for input tax
 * credit and the billing address; its state is the place of supply (CGST + SGST or IGST).
 */
export function BillingContactCard({ contact, companyName, canManage }: { contact: BillingContact | null; companyName: string; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <Card aria-labelledby="billing-contact-title">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle id="billing-contact-title">Billing details</CardTitle>
          <CardDescription>Printed on invoices from Vistar. Add your GSTIN to claim input tax credit.</CardDescription>
        </div>
        {canManage && !editing && (
          <Button size="sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            {contact ? 'Edit' : 'Add details'}
          </Button>
        )}
      </CardHeader>
      {editing ? (
        <ContactForm contact={contact} companyName={companyName} onDone={() => setEditing(false)} />
      ) : (
        <CardContent>
          {contact ? (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item label="Legal name" value={contact.name} />
              <Item label="GSTIN" value={contact.gstin} mono />
              <Item label="Email" value={contact.email} />
              <Item label="Phone" value={contact.phone} />
              <Item label="Address" value={formatAddress(contact.address)} wide />
            </dl>
          ) : (
            <p className="text-sm text-muted-strong">No billing details yet. Invoices use the workspace name until you add them.</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function Item({ label, value, mono, wide }: { label: string; value: string | null | undefined; mono?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs text-muted-strong">{label}</dt>
      <dd className={mono ? 'font-mono text-xs text-fg' : 'text-fg'}>{value || <span className="text-muted">Not set</span>}</dd>
    </div>
  );
}

function ContactForm({ contact, companyName, onDone }: { contact: BillingContact | null; companyName: string; onDone: () => void }) {
  const formId = `billing-contact-${useId().replace(/:/g, '')}`;
  const m = useBillingMutations();
  const [name, setName] = useState(contact?.name ?? companyName);
  const [email, setEmail] = useState(contact?.email ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [gstin, setGstin] = useState(contact?.gstin ?? '');
  const [address, setAddress] = useState<AddressDraft>(() => addressToDraft(contact?.address));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Enter the legal name for invoices.';
    const em = email.trim() ? parseEmail(email) : { value: null, error: null };
    if (em.error) e.email = em.error;
    const ph = phone.trim() ? parsePhone(phone) : { value: null, error: null };
    if (ph.error) e.phone = ph.error;
    if (gstin.trim() && !GstinSchema.safeParse(gstin).success) e.gstin = 'Enter a valid 15-character GSTIN, for example 27AAPFU0939F1ZV.';
    const addr = draftToAddress(address);
    for (const [k, v] of Object.entries(addr.errors)) e[`address.${k}`] = v;
    if (gstin.trim() && addr.value?.stateCode && gstin.trim().slice(0, 2) !== addr.value.stateCode) e.gstin = 'The GSTIN starts with the state code of the address. Check both.';
    setErrors(e);
    setFormError(null);
    if (Object.keys(e).length) {
      setFormError(Object.keys(e).length === 1 ? 'Fix the highlighted field to save.' : `Fix the ${Object.keys(e).length} highlighted fields to save.`);
      focusFirstInvalid(formId);
      return;
    }
    try {
      await m.updateContact.mutateAsync({ name: name.trim(), email: em.value, phone: ph.value as BillingContact['phone'], gstin: gstin.trim() ? gstin.trim().toUpperCase() : null, address: addr.value });
      toast.success('Billing details saved');
      onDone();
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFormError(formErrorMessage(err));
      focusFirstInvalid(formId);
    }
  };

  return (
    <form
      id={formId}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <CardContent className="flex flex-col gap-4">
        {formError && <InlineAlert>{formError}</InlineAlert>}
        <FormGrid>
          <FormField label="Legal name" required error={errors.name} className="sm:col-span-2">
            <Input value={name} maxLength={160} autoComplete="organization" onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="Billing email" error={errors.email} hint="Invoices and payment receipts go here.">
            <Input type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <FormField label="Phone" error={errors.phone}>
            <Input type="tel" value={phone} autoComplete="tel" onChange={(e) => setPhone(e.target.value)} />
          </FormField>
          <FormField label="GSTIN" error={errors.gstin} hint="Optional. Leave empty if you are not GST registered.">
            <Input value={gstin} maxLength={15} className="font-mono uppercase" onChange={(e) => setGstin(e.target.value)} />
          </FormField>
        </FormGrid>
        <AddressFields legend="Billing address" value={address} onChange={setAddress} errors={{ ...nestedErrors(errors, 'address') }} />
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button type="button" onClick={onDone} disabled={m.updateContact.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={m.updateContact.isPending}>
          Save billing details
        </Button>
      </CardFooter>
    </form>
  );
}
