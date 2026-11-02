'use client';

import { DOCUMENT_PREFIX_RE, financialYearOf, formatDocumentNumber, isValidGstin, PAN_RE, panFromGstin, stateCodeFromGstin, type SellerProfile } from '@vistar/shared';
import { useState, type FormEvent } from 'react';
import { useNow } from '@/components/common/use-now';
import { SaveBar, SettingsCard } from '@/components/settings/settings-card';
import { Button } from '@/components/ui/button';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useSaveSellerProfile, useSellerProfile } from '@/lib/crm/catalog';
import { todayIn } from '@/lib/crm/format';
import { formErrorMessage, focusFirstInvalid, nestedErrors, serverFieldErrors } from '@/lib/crm/ui/errors';
import { AddressFields, addressToDraft, draftToAddress, FormGrid, parseEmail, parsePhone, type AddressDraft } from '@/lib/crm/ui/fields';
import { useMe } from '@/lib/session/session';

interface Draft {
  legalName: string;
  tradeName: string;
  gstin: string;
  pan: string;
  address: AddressDraft;
  phone: string;
  email: string;
  website: string;
  accountName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  branch: string;
  upiId: string;
  quotationPrefix: string;
  invoicePrefix: string;
  quotationValidityDays: string;
  paymentTermsDays: string;
  quotationTerms: string;
  invoiceTerms: string;
  signatureLabel: string;
}

function toDraft(p: SellerProfile | null, fallbackName: string): Draft {
  return {
    legalName: p?.legalName ?? fallbackName,
    tradeName: p?.tradeName ?? '',
    gstin: p?.gstin ?? '',
    pan: p?.pan ?? '',
    address: addressToDraft(p?.address),
    phone: p?.phone ?? '',
    email: p?.email ?? '',
    website: p?.website ?? '',
    accountName: p?.bank.accountName ?? '',
    accountNumber: p?.bank.accountNumber ?? '',
    ifsc: p?.bank.ifsc ?? '',
    bankName: p?.bank.bankName ?? '',
    branch: p?.bank.branch ?? '',
    upiId: p?.bank.upiId ?? '',
    quotationPrefix: p?.quotationPrefix ?? 'QT',
    invoicePrefix: p?.invoicePrefix ?? 'INV',
    quotationValidityDays: String(p?.quotationValidityDays ?? 15),
    paymentTermsDays: String(p?.paymentTermsDays ?? 15),
    quotationTerms: p?.quotationTerms ?? '',
    invoiceTerms: p?.invoiceTerms ?? '',
    signatureLabel: p?.signatureLabel ?? 'Authorised signatory',
  };
}

/** Settings > GST and billing: the seller identity, state code (decides CGST + SGST vs IGST), bank, numbering and terms. */
export function BillingProfileSettings() {
  const q = useSellerProfile();
  const me = useMe();
  if (q.isPending) {
    return (
      <div role="status" aria-label="Loading billing details" className="flex flex-col gap-4">
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <SettingsCard title="GST and billing did not load">
        <p className="mb-3 text-sm text-muted-strong">Check your connection, then try again.</p>
        <Button onClick={() => void q.refetch()}>Try again</Button>
      </SettingsCard>
    );
  }
  return <BillingForm profile={q.data.profile} complete={q.data.complete} fallbackName={me?.workspace.name ?? ''} />;
}

function BillingForm({ profile, complete, fallbackName }: { profile: SellerProfile | null; complete: boolean; fallbackName: string }) {
  const formId = 'billing-profile-form';
  const save = useSaveSellerProfile();
  const me = useMe();
  const now = useNow(60_000);
  const fy = now ? financialYearOf(todayIn(me?.workspace.timezone ?? 'Asia/Kolkata', now)) : '2026-27';
  const [initial, setInitial] = useState(() => toDraft(profile, fallbackName));
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setFormError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!draft.legalName.trim()) errs.legalName = 'Enter the legal name as on your GST registration.';
    const gstin = draft.gstin.trim().toUpperCase();
    if (gstin && !isValidGstin(gstin)) errs.gstin = 'Enter a valid 15-character GSTIN.';
    const pan = draft.pan.trim().toUpperCase();
    if (pan && !PAN_RE.test(pan)) errs.pan = 'Enter a valid 10-character PAN.';
    const address = draftToAddress(draft.address);
    Object.entries(address.errors).forEach(([k, v]) => (errs[`address.${k}`] = v));
    if (!address.value && !Object.keys(address.errors).length) errs['address.line1'] = 'Enter your business address with the state.';
    if (gstin && isValidGstin(gstin) && address.value?.stateCode && stateCodeFromGstin(gstin) !== address.value.stateCode) errs['address.stateCode'] = 'The state must match the GSTIN state code.';
    const phone = parsePhone(draft.phone);
    if (phone.error) errs.phone = phone.error;
    const email = parseEmail(draft.email);
    if (email.error) errs.email = email.error;
    if (draft.ifsc.trim() && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(draft.ifsc.trim().toUpperCase())) errs['bank.ifsc'] = 'Enter an 11-character IFSC.';
    if (draft.accountNumber.trim() && !/^\d{6,20}$/.test(draft.accountNumber.trim())) errs['bank.accountNumber'] = 'Use 6 to 20 digits.';
    if (draft.upiId.trim() && !/^[\w.-]{2,64}@[A-Za-z]{2,64}$/.test(draft.upiId.trim())) errs['bank.upiId'] = 'Enter a UPI id like name@bank.';
    if (!DOCUMENT_PREFIX_RE.test(draft.quotationPrefix.trim().toUpperCase())) errs.quotationPrefix = 'Use 1 to 6 letters, digits or "-".';
    if (!DOCUMENT_PREFIX_RE.test(draft.invoicePrefix.trim().toUpperCase())) errs.invoicePrefix = 'Use 1 to 6 letters, digits or "-".';
    const validity = Number(draft.quotationValidityDays);
    if (!Number.isInteger(validity) || validity < 1 || validity > 365) errs.quotationValidityDays = 'Enter 1 to 365 days.';
    const terms = Number(draft.paymentTermsDays);
    if (!Number.isInteger(terms) || terms < 0 || terms > 365) errs.paymentTermsDays = 'Enter 0 to 365 days.';
    let website: string | null = null;
    if (draft.website.trim()) {
      try {
        website = new URL(/^https?:\/\//.test(draft.website.trim()) ? draft.website.trim() : `https://${draft.website.trim()}`).toString();
      } catch {
        errs.website = 'Enter a website like www.company.com.';
      }
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError(Object.keys(errs).length === 1 ? 'Fix the highlighted field to save.' : `Fix the ${Object.keys(errs).length} highlighted fields to save.`);
      focusFirstInvalid(formId);
      return;
    }
    const body: SellerProfile = {
      legalName: draft.legalName.trim(),
      tradeName: draft.tradeName.trim() || null,
      gstin: gstin || null,
      pan: pan || panFromGstin(gstin) || null,
      address: address.value!,
      phone: phone.value,
      email: email.value,
      website,
      bank: {
        accountName: draft.accountName.trim() || null,
        accountNumber: draft.accountNumber.trim() || null,
        ifsc: draft.ifsc.trim().toUpperCase() || null,
        bankName: draft.bankName.trim() || null,
        branch: draft.branch.trim() || null,
        upiId: draft.upiId.trim() || null,
      },
      quotationPrefix: draft.quotationPrefix.trim().toUpperCase(),
      invoicePrefix: draft.invoicePrefix.trim().toUpperCase(),
      quotationValidityDays: validity,
      paymentTermsDays: terms,
      quotationTerms: draft.quotationTerms.trim() || null,
      invoiceTerms: draft.invoiceTerms.trim() || null,
      signatureLabel: draft.signatureLabel.trim() || 'Authorised signatory',
    };
    try {
      const res = await save.mutateAsync(body);
      const next = toDraft(res.profile, fallbackName);
      setInitial(next);
      setDraft(next);
      toast.success('GST and billing details saved');
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFormError(formErrorMessage(err));
      focusFirstInvalid(formId);
    }
  };

  const footer = <SaveBar dirty={dirty} saving={save.isPending} onDiscard={() => setDraft(initial)} />;

  return (
    <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      {!complete && (
        <p role="status" className="rounded-md border border-status-amber-border bg-status-amber-bg px-3 py-2 text-sm text-status-amber-fg">
          Add your legal name and business address with the state. Quotations cannot be sent and invoices cannot be issued until then.
        </p>
      )}
      {formError && (
        <p role="alert" className="rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-sm text-status-red-fg">
          {formError}
        </p>
      )}
      <SettingsCard title="Business identity" description="Printed on quotations and invoices. The state of this address decides CGST + SGST (same state) or IGST (other states).">
        <div className="flex flex-col gap-5">
          <FormGrid className="xl:grid-cols-3">
            <FormField label="Legal name" required error={errors.legalName}>
              <Input value={draft.legalName} maxLength={160} onChange={(e) => set({ legalName: e.target.value })} />
            </FormField>
            <FormField label="Trade name" hint="Shown large on documents when set">
              <Input value={draft.tradeName} maxLength={160} onChange={(e) => set({ tradeName: e.target.value })} />
            </FormField>
            <FormField label="GSTIN" error={errors.gstin} hint="Empty = not GST registered">
              <Input
                value={draft.gstin}
                maxLength={15}
                className="uppercase"
                onChange={(e) => {
                  const g = e.target.value.toUpperCase();
                  set({ gstin: g, ...(isValidGstin(g) && !draft.address.stateCode ? { address: { ...draft.address, stateCode: stateCodeFromGstin(g) } } : {}) });
                }}
              />
            </FormField>
            <FormField label="PAN" error={errors.pan}>
              <Input value={draft.pan} maxLength={10} className="uppercase" onChange={(e) => set({ pan: e.target.value.toUpperCase() })} />
            </FormField>
            <FormField label="Phone" error={errors.phone}>
              <Input type="tel" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} />
            </FormField>
            <FormField label="Email" error={errors.email}>
              <Input type="email" value={draft.email} onChange={(e) => set({ email: e.target.value })} />
            </FormField>
            <FormField label="Website" error={errors.website}>
              <Input value={draft.website} onChange={(e) => set({ website: e.target.value })} />
            </FormField>
            <FormField label="Signature label">
              <Input value={draft.signatureLabel} maxLength={80} onChange={(e) => set({ signatureLabel: e.target.value })} />
            </FormField>
          </FormGrid>
          <AddressFields legend="Business address" value={draft.address} onChange={(address) => set({ address })} errors={nestedErrors(errors, 'address')} />
        </div>
      </SettingsCard>
      <SettingsCard title="Bank and UPI" description="Shown in the payment details of invoices.">
        <FormGrid className="xl:grid-cols-3">
          <FormField label="Account name">
            <Input value={draft.accountName} onChange={(e) => set({ accountName: e.target.value })} />
          </FormField>
          <FormField label="Account number" error={errors['bank.accountNumber']}>
            <Input inputMode="numeric" value={draft.accountNumber} onChange={(e) => set({ accountNumber: e.target.value.replace(/\D/g, '') })} />
          </FormField>
          <FormField label="IFSC" error={errors['bank.ifsc']}>
            <Input value={draft.ifsc} maxLength={11} className="uppercase" onChange={(e) => set({ ifsc: e.target.value.toUpperCase() })} />
          </FormField>
          <FormField label="Bank">
            <Input value={draft.bankName} onChange={(e) => set({ bankName: e.target.value })} />
          </FormField>
          <FormField label="Branch">
            <Input value={draft.branch} onChange={(e) => set({ branch: e.target.value })} />
          </FormField>
          <FormField label="UPI id" error={errors['bank.upiId']}>
            <Input value={draft.upiId} onChange={(e) => set({ upiId: e.target.value })} />
          </FormField>
        </FormGrid>
      </SettingsCard>
      <SettingsCard title="Numbering and terms" description={`Numbers restart each financial year (1 April). Next numbers look like ${formatDocumentNumber(draft.quotationPrefix.toUpperCase() || 'QT', fy, 1)} and ${formatDocumentNumber(draft.invoicePrefix.toUpperCase() || 'INV', fy, 1)}.`} footer={footer}>
        <FormGrid className="xl:grid-cols-4">
          <FormField label="Quotation prefix" error={errors.quotationPrefix}>
            <Input value={draft.quotationPrefix} maxLength={6} className="uppercase" onChange={(e) => set({ quotationPrefix: e.target.value.toUpperCase() })} />
          </FormField>
          <FormField label="Invoice prefix" error={errors.invoicePrefix}>
            <Input value={draft.invoicePrefix} maxLength={6} className="uppercase" onChange={(e) => set({ invoicePrefix: e.target.value.toUpperCase() })} />
          </FormField>
          <FormField label="Quotations valid for (days)" error={errors.quotationValidityDays}>
            <Input inputMode="numeric" value={draft.quotationValidityDays} onChange={(e) => set({ quotationValidityDays: e.target.value.replace(/\D/g, '') })} />
          </FormField>
          <FormField label="Payment due after (days)" error={errors.paymentTermsDays}>
            <Input inputMode="numeric" value={draft.paymentTermsDays} onChange={(e) => set({ paymentTermsDays: e.target.value.replace(/\D/g, '') })} />
          </FormField>
          <FormField label="Quotation terms" className="sm:col-span-2">
            <Textarea rows={5} value={draft.quotationTerms} maxLength={4000} onChange={(e) => set({ quotationTerms: e.target.value })} />
          </FormField>
          <FormField label="Invoice terms" className="sm:col-span-2">
            <Textarea rows={5} value={draft.invoiceTerms} maxLength={4000} onChange={(e) => set({ invoiceTerms: e.target.value })} />
          </FormField>
        </FormGrid>
      </SettingsCard>
    </form>
  );
}
