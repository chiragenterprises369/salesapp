'use client';

import { isValidGstin, stateName, type Account, type Contact, type Invoice, type Party, type Quotation } from '@vistar/shared';
import { AlertTriangle, Eye, PencilLine } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { useNow } from '@/components/common/use-now';
import { Segmented } from '@/components/dashboard/segmented';
import { Checkbox } from '@/components/leads/primitives/checkbox';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { usePriceList, usePriceLists, useSellerProfile } from '@/lib/crm/catalog';
import { useDeal } from '@/lib/crm/deals';
import { useInvoiceMutations, useQuotationMutations } from '@/lib/crm/documents';
import { todayIn } from '@/lib/crm/format';
import { emptyLine, lineFromItem, linesProblems, mapLineErrors, previewTotals, toLineInputs, type LineDraft } from '@/lib/crm/lines';
import { useAccount, useContact } from '@/lib/crm/parties';
import { formErrorMessage, focusFirstInvalid, nestedErrors, serverFieldErrors } from '@/lib/crm/ui/errors';
import { AddressFields, addressToDraft, draftToAddress, emptyAddress, FormGrid, FormSection, OwnerSelect, parseEmail, parsePhone, StateSelect, type AddressDraft } from '@/lib/crm/ui/fields';
import { AccountPicker, ContactPicker } from '@/lib/crm/ui/pickers';
import type { PickerOption } from '@/lib/crm/ui/record-picker';
import { useCan, useMe } from '@/lib/session/session';
import { mapAmounts } from '@/components/deals/deal-form';
import { DocumentPreview } from './document-preview';
import { LineItemsEditor, TotalsPanel } from './line-items-editor';

export type DocKind = 'quotation' | 'invoice';

export interface EditorSeed {
  accountId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  leadId?: string | null;
}

interface BuyerDraft {
  name: string;
  gstin: string;
  phone: string;
  email: string;
  contactName: string;
  billing: AddressDraft;
  shipping: AddressDraft;
  shippingSame: boolean;
}

const buyerFromParty = (p: Party | null | undefined): BuyerDraft => ({
  name: p?.name ?? '',
  gstin: p?.gstin ?? '',
  phone: p?.phone ?? '',
  email: p?.email ?? '',
  contactName: p?.contactName ?? '',
  billing: addressToDraft(p?.billingAddress),
  shipping: addressToDraft(p?.shippingAddress),
  shippingSame: !p?.shippingAddress,
});

const buyerFromAccount = (a: Account, contactName: string): BuyerDraft => ({
  name: a.name,
  gstin: a.gstin ?? '',
  phone: a.phone ?? '',
  email: a.email ?? '',
  contactName,
  billing: addressToDraft(a.billingAddress),
  shipping: addressToDraft(a.shippingAddress),
  shippingSame: !a.shippingAddress,
});

const buyerFromContact = (c: Contact): BuyerDraft => ({
  name: c.name,
  gstin: c.gstin ?? '',
  phone: c.phone ?? '',
  email: c.email ?? '',
  contactName: '',
  billing: addressToDraft(c.billingAddress),
  shipping: addressToDraft(c.shippingAddress),
  shippingSame: !c.shippingAddress,
});

type Existing = Quotation | Invoice;

/**
 * Quotation and invoice editor (new and drafts): buyer from an account or contact (editable
 * snapshot), place of supply, dates, price list, line items with live GST (CGST + SGST inside the
 * seller state, IGST across states, from the shared GST math), notes and terms, and a preview.
 */
export function DocumentEditor({ kind, existing, seed = {}, onDone }: { kind: DocKind; existing?: Existing; seed?: EditorSeed; onDone?: (id: string) => void }) {
  const formId = useId().replace(/:/g, '');
  const router = useRouter();
  const me = useMe();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const now = useNow(60_000);
  const today = now ? todayIn(tz, now) : '';
  const seller = useSellerProfile();
  const priceLists = usePriceLists();
  const qm = useQuotationMutations();
  const im = useInvoiceMutations();
  const canAssign = useCan('leads.assign');
  const canManageSettings = useCan('settings.manage');
  const noun = kind === 'quotation' ? 'quotation' : 'invoice';

  const [account, setAccount] = useState<PickerOption | null>(existing?.account ? { id: existing.account.id, label: existing.account.name } : null);
  const [contact, setContact] = useState<PickerOption | null>(existing?.contact ? { id: existing.contact.id, label: existing.contact.name } : null);
  const [dealId] = useState<string | null>(existing?.dealId ?? seed.dealId ?? null);
  const [leadId] = useState<string | null>(existing?.lead?.id ?? seed.leadId ?? null);
  const [ownerId, setOwnerId] = useState<string | null>(existing ? (existing.owner?.id ?? null) : (me?.user.id ?? null));
  const [buyer, setBuyer] = useState<BuyerDraft>(() => buyerFromParty(existing?.buyer));
  const [buyerFilledFor, setBuyerFilledFor] = useState<string | null>(existing ? `a:${existing.account?.id ?? ''}|c:${existing.contact?.id ?? ''}` : null);
  const [pos, setPos] = useState<string | null>(existing?.placeOfSupplyStateCode ?? null);
  const [posTouched, setPosTouched] = useState(!!existing);
  const [issueDate, setIssueDate] = useState(existing?.issueDate ?? '');
  const [validUntil, setValidUntil] = useState(existing && 'validUntil' in existing ? (existing.validUntil ?? '') : '');
  const [dueDate, setDueDate] = useState(existing && 'dueDate' in existing ? (existing.dueDate ?? '') : '');
  const [priceListId, setPriceListId] = useState<string | null | undefined>(existing ? existing.priceListId : undefined);
  const [lines, setLines] = useState<LineDraft[]>(() => (existing?.lines.length ? existing.lines.map(lineFromItem) : [emptyLine()]));
  const [linesFromDeal, setLinesFromDeal] = useState(!!existing);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [terms, setTerms] = useState<string | null>(existing ? (existing.terms ?? '') : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [view, setView] = useState<'edit' | 'preview'>('edit');

  // Seeds from the page URL (account, contact, deal) arrive once.
  const [seeded, setSeeded] = useState(!!existing);
  const seedAccount = useAccount(!seeded ? seed.accountId : null);
  const seedContact = useContact(!seeded ? seed.contactId : null);
  if (!seeded && (!seed.accountId || seedAccount.data || seedAccount.isError) && (!seed.contactId || seedContact.data || seedContact.isError)) {
    setSeeded(true);
    if (seedAccount.data) setAccount({ id: seedAccount.data.id, label: seedAccount.data.name });
    if (seedContact.data) setContact({ id: seedContact.data.id, label: seedContact.data.name });
  }

  // Buyer snapshot follows the picked account (else contact) until the person edits it.
  const accountDetail = useAccount(account?.id);
  const contactDetail = useContact(contact?.id);
  const pickedKey = `a:${account?.id ?? ''}|c:${contact?.id ?? ''}`;
  if (pickedKey !== buyerFilledFor) {
    if (account && accountDetail.data && (!contact || contactDetail.data)) {
      setBuyer(buyerFromAccount(accountDetail.data, contactDetail.data?.name ?? ''));
      setBuyerFilledFor(pickedKey);
      setPosTouched(false);
    } else if (!account && contact && contactDetail.data) {
      setBuyer(buyerFromContact(contactDetail.data));
      setBuyerFilledFor(pickedKey);
      setPosTouched(false);
    } else if (!account && !contact) {
      setBuyerFilledFor(pickedKey);
    }
  }

  // Lines from the deal (new documents made from a deal).
  const deal = useDeal(!linesFromDeal ? dealId : null);
  if (!linesFromDeal && (!dealId || deal.data || deal.isError)) {
    setLinesFromDeal(true);
    if (deal.data?.lines.length) setLines(deal.data.lines.map((l) => ({ ...lineFromItem(l), key: `${l.id}-d` })));
    if (deal.data && !account && deal.data.account) setAccount({ id: deal.data.account.id, label: deal.data.account.name });
    if (deal.data && !contact && deal.data.contact) setContact({ id: deal.data.contact.id, label: deal.data.contact.name });
  }

  const sellerState = seller.data?.stateCode ?? null;
  const shippingState = buyer.shippingSame ? null : buyer.shipping.stateCode;
  const placeOfSupply = posTouched ? pos : (shippingState ?? buyer.billing.stateCode ?? sellerState);
  const defaultList = priceLists.data?.items.find((l) => l.isDefault && l.active) ?? null;
  const chosenListId = priceListId === undefined ? (defaultList?.id ?? null) : priceListId;
  const priceList = usePriceList(chosenListId);
  const termsValue = terms ?? (kind === 'quotation' ? seller.data?.profile?.quotationTerms : seller.data?.profile?.invoiceTerms) ?? '';
  const gstRegistered = !seller.data?.profile || !!seller.data.profile.gstin;
  const preview = useMemo(() => previewTotals(lines, sellerState, placeOfSupply, { gstRegistered }), [lines, sellerState, placeOfSupply, gstRegistered]);
  const amounts = mapAmounts(lines, preview.lines);
  const sellerIncomplete = seller.isSuccess && !seller.data.complete;

  const setB = (patch: Partial<BuyerDraft>) => {
    setBuyer((b) => ({ ...b, ...patch }));
    setFormError(null);
  };

  const buildParty = () => {
    const e: Record<string, string> = {};
    if (!buyer.name.trim()) e['buyer.name'] = 'Enter the buyer name or pick an account.';
    const gstin = buyer.gstin.trim().toUpperCase();
    if (gstin && !isValidGstin(gstin)) e['buyer.gstin'] = 'Enter a valid 15-character GSTIN.';
    const phone = parsePhone(buyer.phone);
    if (phone.error) e['buyer.phone'] = phone.error;
    const email = parseEmail(buyer.email);
    if (email.error) e['buyer.email'] = email.error;
    const billing = draftToAddress(buyer.billing);
    Object.entries(billing.errors).forEach(([k, v]) => (e[`buyer.billingAddress.${k}`] = v));
    const shipping = buyer.shippingSame ? { value: null, errors: {} } : draftToAddress(buyer.shipping);
    Object.entries(shipping.errors).forEach(([k, v]) => (e[`buyer.shippingAddress.${k}`] = v));
    const party: Party = { name: buyer.name.trim(), gstin: gstin || null, pan: null, phone: phone.value, email: email.value, billingAddress: billing.value, shippingAddress: shipping.value, contactName: buyer.contactName.trim() || null };
    return { party, errors: e };
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { party, errors: be } = buildParty();
    const le = linesProblems(lines);
    const errs: Record<string, string> = { ...be, ...le };
    const used = toLineInputs(lines);
    if (!used.length) errs.lines = 'Add at least one line item.';
    if (kind === 'quotation' && validUntil && issueDate && validUntil < issueDate) errs.validUntil = 'Valid until is before the quotation date.';
    if (kind === 'invoice' && dueDate && issueDate && dueDate < issueDate) errs.dueDate = 'The due date is before the invoice date.';
    setErrors(errs);
    if (Object.keys(errs).length) {
      setView('edit');
      setFormError(Object.keys(errs).length === 1 ? 'Fix the highlighted field to save.' : `Fix the ${Object.keys(errs).length} highlighted fields to save.`);
      focusFirstInvalid(formId);
      return;
    }
    const common = {
      accountId: account?.id ?? null,
      contactId: contact?.id ?? null,
      dealId,
      leadId,
      ...(canAssign || !existing ? { ownerId } : {}),
      buyer: party,
      placeOfSupplyStateCode: placeOfSupply,
      ...(issueDate ? { issueDate } : {}),
      priceListId: chosenListId,
      lines: used,
      notes: notes.trim() || null,
      terms: termsValue.trim() || null,
    };
    try {
      let id: string;
      if (kind === 'quotation') {
        const body = { ...common, validUntil: validUntil || null };
        const saved = existing ? await qm.update.mutateAsync({ id: existing.id, patch: { ...body, expectedVersion: existing.version } }) : await qm.create.mutateAsync(body);
        id = saved.id;
        toast.success(existing ? `Quotation ${saved.number} saved` : `Quotation ${saved.number} created as a draft`);
      } else {
        const body = { ...common, dueDate: dueDate || null };
        const saved = existing ? await im.update.mutateAsync({ id: existing.id, patch: { ...body, expectedVersion: existing.version } }) : await im.create.mutateAsync(body);
        id = saved.id;
        toast.success(existing ? 'Invoice draft saved' : 'Invoice draft created. Issue it to give it a number.');
      }
      if (onDone) onDone(id);
      else router.push(`/app/${kind === 'quotation' ? 'quotations' : 'invoices'}/${id}`);
    } catch (err) {
      setErrors(mapLineErrors(serverFieldErrors(err), lines));
      setFormError(formErrorMessage(err));
      setView('edit');
      focusFirstInvalid(formId);
    }
  };

  const saving = qm.create.isPending || qm.update.isPending || im.create.isPending || im.update.isPending;
  const previewDoc = {
    kind,
    number: existing ? ('number' in existing ? existing.number : null) : null,
    issueDate: issueDate || today,
    validUntil: kind === 'quotation' ? validUntil || null : null,
    dueDate: kind === 'invoice' ? dueDate || null : null,
    seller: seller.data?.profile ?? null,
    buyer: buildParty().party,
    placeOfSupplyStateCode: placeOfSupply,
    lines: preview.lines.map((l, i) => {
      const src = lines.filter((x) => !(!x.productId && !x.name.trim() && !x.unitPrice.trim() && !x.hsnSac.trim()))[i]!;
      return { ...l, key: src.key, name: src.name, description: src.description || null, hsnSac: src.hsnSac || null, unit: src.unit, gstRate: src.gstRate };
    }),
    totals: preview.totals,
    notes: notes || null,
    terms: termsValue || null,
    logoUrl: me?.workspace.branding?.logoLight?.url ?? null,
  };

  return (
    <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="flex w-full min-w-0 flex-col gap-4">
      {sellerIncomplete && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-amber-border bg-status-amber-bg px-3 py-2 text-sm text-status-amber-fg">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle aria-hidden className="size-4" />
            Your GST and billing details are not complete. You can save drafts; {kind === 'quotation' ? 'sending' : 'issuing'} needs your legal name and state.
          </span>
          {canManageSettings && (
            <Button asChild size="sm">
              <Link href="/app/settings/billing-profile">Complete billing details</Link>
            </Button>
          )}
        </div>
      )}
      {formError && (
        <p role="alert" className="rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-sm text-status-red-fg">
          {formError}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <Segmented
          label="Editor view"
          value={view}
          onChange={setView}
          options={[
            { value: 'edit', label: 'Edit' },
            { value: 'preview', label: 'Preview' },
          ]}
        />
        <span className="sr-only" aria-live="polite">
          {view === 'preview' ? `Showing the ${noun} preview` : `Editing the ${noun}`}
        </span>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {view === 'preview' ? (
            <DocumentPreview doc={previewDoc} />
          ) : (
            <>
              <Card className="p-4">
                <FormSection title="Buyer">
                  <FormGrid>
                    <FormField label="Account">
                      <AccountPicker
                        value={account}
                        onChange={(a) => {
                          setAccount(a);
                          if (a?.id !== account?.id) setContact(null);
                        }}
                      />
                    </FormField>
                    <FormField label="Contact">
                      <ContactPicker accountId={account?.id} value={contact} onChange={setContact} />
                    </FormField>
                    <FormField label="Buyer name" required error={errors['buyer.name']}>
                      <Input value={buyer.name} onChange={(e) => setB({ name: e.target.value })} />
                    </FormField>
                    <FormField label="Buyer GSTIN" error={errors['buyer.gstin']} hint="Leave empty for unregistered buyers">
                      <Input value={buyer.gstin} maxLength={15} className="uppercase" onChange={(e) => setB({ gstin: e.target.value.toUpperCase() })} />
                    </FormField>
                    <FormField label="Phone" error={errors['buyer.phone']}>
                      <Input type="tel" value={buyer.phone} onChange={(e) => setB({ phone: e.target.value })} />
                    </FormField>
                    <FormField label="Email" error={errors['buyer.email']}>
                      <Input type="email" value={buyer.email} onChange={(e) => setB({ email: e.target.value })} />
                    </FormField>
                    <FormField label="Attention (contact person)">
                      <Input value={buyer.contactName} onChange={(e) => setB({ contactName: e.target.value })} />
                    </FormField>
                    <FormField label="Place of supply" error={errors.placeOfSupplyStateCode} hint={posTouched ? 'Set by you' : 'From the shipping or billing state'}>
                      <StateSelect
                        value={placeOfSupply}
                        onChange={(code) => {
                          setPos(code);
                          setPosTouched(true);
                        }}
                      />
                    </FormField>
                  </FormGrid>
                </FormSection>
                <div className="mt-4 flex flex-col gap-4">
                  <AddressFields legend="Billing address" value={buyer.billing} onChange={(billing) => setB({ billing })} errors={nestedErrors(errors, 'buyer.billingAddress')} />
                  <div className="flex items-center gap-2">
                    <Checkbox id={`${formId}-ship`} checked={buyer.shippingSame} onCheckedChange={(v) => setB({ shippingSame: v === true, shipping: v === true ? emptyAddress() : buyer.billing })} />
                    <label htmlFor={`${formId}-ship`} className="text-sm text-fg">
                      Ship to the billing address
                    </label>
                  </div>
                  {!buyer.shippingSame && <AddressFields legend="Shipping address" value={buyer.shipping} onChange={(shipping) => setB({ shipping })} errors={nestedErrors(errors, 'buyer.shippingAddress')} />}
                </div>
              </Card>
              <Card className="p-4">
                <FormSection title="Dates and pricing">
                  <FormGrid className="lg:grid-cols-4">
                    <FormField label={kind === 'quotation' ? 'Quotation date' : 'Invoice date'} hint="Empty = today">
                      <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                    </FormField>
                    {kind === 'quotation' ? (
                      <FormField label="Valid until" error={errors.validUntil} hint={seller.data?.profile ? `Empty = ${seller.data.profile.quotationValidityDays} days` : undefined}>
                        <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                      </FormField>
                    ) : (
                      <FormField label="Due date" error={errors.dueDate} hint={seller.data?.profile ? `Empty = ${seller.data.profile.paymentTermsDays} days` : undefined}>
                        <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                      </FormField>
                    )}
                    <FormField label="Price list">
                      <NativeSelect value={chosenListId ?? ''} onChange={(e) => setPriceListId(e.target.value || null)}>
                        <option value="">Product prices</option>
                        {(priceLists.data?.items ?? [])
                          .filter((l) => l.active)
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                      </NativeSelect>
                    </FormField>
                    {(canAssign || !existing) && (
                      <FormField label="Owner">
                        <OwnerSelect value={ownerId} onChange={setOwnerId} />
                      </FormField>
                    )}
                  </FormGrid>
                </FormSection>
              </Card>
              <Card className="p-4">
                <FormSection title="Line items">
                  {errors.lines && (
                    <p role="alert" className="text-sm text-danger-text">
                      {errors.lines}
                    </p>
                  )}
                  <LineItemsEditor lines={lines} onChange={setLines} amounts={amounts} errors={errors} priceList={priceList.data ?? null} taxMode={preview.totals.taxMode} noGst={!gstRegistered} />
                </FormSection>
              </Card>
              <Card className="p-4">
                <FormGrid>
                  <FormField label="Notes" hint="Shown on the document">
                    <Textarea rows={4} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />
                  </FormField>
                  <FormField label="Terms" hint="From your billing details; change them for this document only">
                    <Textarea rows={4} value={termsValue} maxLength={4000} onChange={(e) => setTerms(e.target.value)} />
                  </FormField>
                </FormGrid>
              </Card>
            </>
          )}
        </div>
        <aside className="flex flex-col gap-4 xl:sticky xl:top-0 xl:self-start">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-fg">Totals</h2>
            <TotalsPanel totals={preview.totals} placeOfSupply={placeOfSupply} sellerState={sellerState} />
            {!gstRegistered && <p className="mt-3 text-xs text-muted-strong">Your billing details have no GSTIN, so no GST is charged (not GST registered).</p>}
            {!sellerState && seller.isSuccess && <p className="mt-3 text-xs text-warning-text">No seller state yet: GST is shown as CGST + SGST until your billing details have a state.</p>}
            {placeOfSupply && sellerState && <p className="mt-3 text-xs text-muted-strong">Seller state {stateName(sellerState)} ({sellerState}), place of supply {stateName(placeOfSupply)} ({placeOfSupply}).</p>}
          </Card>
          <div className="flex flex-col gap-2">
            <Button type="submit" variant="primary" loading={saving} className="h-11 sm:h-9">
              {existing ? 'Save draft' : `Save ${noun} as draft`}
            </Button>
            <Button onClick={() => setView(view === 'edit' ? 'preview' : 'edit')} className="h-11 sm:h-9">
              {view === 'edit' ? <Eye aria-hidden /> : <PencilLine aria-hidden />}
              {view === 'edit' ? 'Preview' : 'Back to editing'}
            </Button>
            {onDone && existing && (
              <Button variant="ghost" onClick={() => onDone(existing.id)}>
                Cancel
              </Button>
            )}
          </div>
        </aside>
      </div>
    </form>
  );
}

