'use client';

import {
  DOCUMENT_PREFIX_RE,
  GST_RATES,
  isValidGstin,
  PAN_RE,
  panFromGstin,
  stateCodeFromGstin,
  type PlatformBillingProfile,
  type RouteBody,
} from '@vistar/shared';
import { useId, useState, type FormEvent } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { InlineAlert, LoadError } from '@/components/settings/common/states';
import { SaveBar, SettingsCard } from '@/components/settings/settings-card';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useSaveVistarBillingProfile, useVistarBillingProfile } from '@/lib/config/platform';
import { focusFirstInvalid, formErrorMessage, nestedErrors, serverFieldErrors } from '@/lib/crm/ui/errors';
import { AddressFields, addressToDraft, draftToAddress, FormGrid, parseEmail, parsePhone, type AddressDraft } from '@/lib/crm/ui/fields';
import { useCan } from '@/lib/session/session';

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
  signatureLabel: string;
  invoicePrefix: string;
  sacCode: string;
  gstRate: string;
  paymentTermsDays: string;
  invoiceTerms: string;
  brandColor: string;
}

function toDraft(p: PlatformBillingProfile | null): Draft {
  return {
    legalName: p?.legalName ?? '',
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
    signatureLabel: p?.signatureLabel ?? 'Authorised signatory',
    invoicePrefix: p?.invoicePrefix ?? 'VST',
    sacCode: p?.sacCode ?? '998314',
    gstRate: String(p?.gstRate ?? 18),
    paymentTermsDays: String(p?.paymentTermsDays ?? 7),
    invoiceTerms: p?.invoiceTerms ?? '',
    brandColor: p?.brandColor ?? '',
  };
}

/** Super Admin > Config > Vistar billing profile: the seller identity on Vistar's own invoices to companies. */
export function VistarBillingProfileCard() {
  const canManage = useCan('platform.billing.manage');
  const q = useVistarBillingProfile();
  if (!canManage)
    return (
      <SettingsCard title="Vistar billing profile">
        <p className="text-sm text-muted-strong">Your Super Admin role does not include billing. Ask an owner for platform billing access.</p>
      </SettingsCard>
    );
  if (q.isPending)
    return (
      <div role="status" aria-label="Loading the billing profile" className="flex flex-col gap-4">
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  if (q.isError || !q.data) return <LoadError title="The billing profile did not load" onRetry={() => void q.refetch()} />;
  return <ProfileForm key={JSON.stringify(q.data.profile)} profile={q.data.profile} complete={q.data.complete} />;
}

function ProfileForm({ profile, complete }: { profile: PlatformBillingProfile | null; complete: boolean }) {
  const formId = useId();
  const save = useSaveVistarBillingProfile();
  const [initial] = useState(() => toDraft(profile));
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setFormError(null);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!draft.legalName.trim()) errs.legalName = 'Enter Vistar\'s legal name as on the GST registration.';
    const gstin = draft.gstin.trim().toUpperCase();
    if (gstin && !isValidGstin(gstin)) errs.gstin = 'Enter a valid 15-character GSTIN.';
    const pan = draft.pan.trim().toUpperCase();
    if (pan && !PAN_RE.test(pan)) errs.pan = 'Enter a valid 10-character PAN.';
    const address = draftToAddress(draft.address);
    Object.entries(address.errors).forEach(([k, v]) => (errs[`address.${k}`] = v));
    if (!address.value && !Object.keys(address.errors).length) errs['address.line1'] = 'Enter the registered address with the state.';
    if (gstin && isValidGstin(gstin) && address.value?.stateCode && stateCodeFromGstin(gstin) !== address.value.stateCode) errs['address.stateCode'] = 'The state must match the GSTIN state code.';
    const phone = parsePhone(draft.phone);
    if (phone.error) errs.phone = phone.error;
    const email = parseEmail(draft.email);
    if (email.error) errs.email = email.error;
    if (draft.ifsc.trim() && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(draft.ifsc.trim().toUpperCase())) errs['bank.ifsc'] = 'Enter an 11-character IFSC.';
    if (draft.accountNumber.trim() && !/^\d{6,20}$/.test(draft.accountNumber.trim())) errs['bank.accountNumber'] = 'Use 6 to 20 digits.';
    if (draft.upiId.trim() && !/^[\w.-]{2,64}@[A-Za-z]{2,64}$/.test(draft.upiId.trim())) errs['bank.upiId'] = 'Enter a UPI id like name@bank.';
    if (!DOCUMENT_PREFIX_RE.test(draft.invoicePrefix.trim().toUpperCase())) errs.invoicePrefix = 'Use 1 to 6 letters, digits or "-".';
    if (!/^\d{4,8}$/.test(draft.sacCode.trim())) errs.sacCode = 'Enter a 4 to 8 digit SAC code (998314 for IT services).';
    const terms = Number(draft.paymentTermsDays);
    if (!Number.isInteger(terms) || terms < 0 || terms > 60) errs.paymentTermsDays = 'Enter 0 to 60 days.';
    const color = draft.brandColor.trim();
    if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) errs.brandColor = 'Use a hex colour like #4F46E5.';
    let website: string | null = null;
    if (draft.website.trim()) {
      try {
        website = new URL(/^https?:\/\//.test(draft.website.trim()) ? draft.website.trim() : `https://${draft.website.trim()}`).toString();
      } catch {
        errs.website = 'Enter a website like www.vistar.app.';
      }
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError(Object.keys(errs).length === 1 ? 'Fix the highlighted field to save.' : `Fix the ${Object.keys(errs).length} highlighted fields to save.`);
      focusFirstInvalid(formId);
      return;
    }
    const body: RouteBody<'superBillingProfileUpdate'> = {
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
      signatureLabel: draft.signatureLabel.trim() || 'Authorised signatory',
      invoicePrefix: draft.invoicePrefix.trim().toUpperCase(),
      sacCode: draft.sacCode.trim(),
      gstRate: Number(draft.gstRate) as (typeof GST_RATES)[number],
      paymentTermsDays: terms,
      invoiceTerms: draft.invoiceTerms.trim() || null,
      brandColor: color || null,
    };
    try {
      await save.mutateAsync(body);
      toast.success('Vistar billing profile saved');
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFormError(formErrorMessage(err));
      focusFirstInvalid(formId);
    }
  }

  return (
    <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      {!complete && (
        <InlineAlert tone="warning" title="Invoices wait for this profile">
          Add the legal name and the registered address with its state. Until then Vistar invoices cannot be issued and renewals wait.
        </InlineAlert>
      )}
      {formError && <InlineAlert>{formError}</InlineAlert>}
      <SettingsCard title="Vistar's GST identity" description="Printed as the seller on every Vistar invoice. The state decides CGST + SGST (same state as the company) or IGST.">
        <div className="flex flex-col gap-5">
          <FormGrid className="xl:grid-cols-3">
            <FormField label="Legal name" required error={errors.legalName}>
              <Input value={draft.legalName} maxLength={160} onChange={(e) => set({ legalName: e.target.value })} />
            </FormField>
            <FormField label="Trade name" hint="Shown large on invoices when set">
              <Input value={draft.tradeName} maxLength={160} onChange={(e) => set({ tradeName: e.target.value })} />
            </FormField>
            <FormField label="GSTIN" error={errors.gstin}>
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
            <FormField label="Billing e-mail" error={errors.email}>
              <Input type="email" value={draft.email} onChange={(e) => set({ email: e.target.value })} />
            </FormField>
            <FormField label="Website" error={errors.website}>
              <Input value={draft.website} onChange={(e) => set({ website: e.target.value })} />
            </FormField>
            <FormField label="Signature label">
              <Input value={draft.signatureLabel} maxLength={80} onChange={(e) => set({ signatureLabel: e.target.value })} />
            </FormField>
          </FormGrid>
          <AddressFields legend="Registered address" value={draft.address} onChange={(address) => set({ address })} errors={nestedErrors(errors, 'address')} />
        </div>
      </SettingsCard>
      <SettingsCard title="Bank and UPI" description="Payment details on Vistar invoices (for bank transfers when online payment is off).">
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
      <SettingsCard
        title="Invoice numbering and terms"
        description="Vistar invoice numbers look like VST/2026-27/0001 and restart every financial year."
        footer={<SaveBar dirty={dirty} saving={save.isPending} onDiscard={() => setDraft(initial)} />}
      >
        <FormGrid className="xl:grid-cols-4">
          <FormField label="Invoice prefix" error={errors.invoicePrefix}>
            <Input value={draft.invoicePrefix} maxLength={6} className="uppercase" onChange={(e) => set({ invoicePrefix: e.target.value.toUpperCase() })} />
          </FormField>
          <FormField label="SAC code" error={errors.sacCode} hint="998314: IT design and development services">
            <Input inputMode="numeric" value={draft.sacCode} maxLength={8} onChange={(e) => set({ sacCode: e.target.value.replace(/\D/g, '') })} />
          </FormField>
          <FormField label="GST rate">
            <NativeSelect value={draft.gstRate} onChange={(e) => set({ gstRate: e.target.value })}>
              {GST_RATES.map((r) => (
                <option key={r} value={String(r)}>{`${r}%`}</option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Payment due after (days)" error={errors.paymentTermsDays}>
            <Input inputMode="numeric" value={draft.paymentTermsDays} onChange={(e) => set({ paymentTermsDays: e.target.value.replace(/\D/g, '') })} />
          </FormField>
          <FormField label="Brand colour on invoices" error={errors.brandColor} hint="Hex, e.g. #4F46E5. Empty = Vistar indigo">
            <Input value={draft.brandColor} maxLength={7} spellCheck={false} onChange={(e) => set({ brandColor: e.target.value })} />
          </FormField>
          <FormField label="Invoice terms" className="sm:col-span-2 xl:col-span-3">
            <Textarea rows={4} value={draft.invoiceTerms} maxLength={4000} onChange={(e) => set({ invoiceTerms: e.target.value })} />
          </FormField>
        </FormGrid>
      </SettingsCard>
    </form>
  );
}
