'use client';

import { formatInr, type CustomFieldValues, type Deal, type DealUpdate } from '@vistar/shared';
import { Package } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { LineItemsEditor } from '@/components/quotations/line-items-editor';
import { Button } from '@/components/ui/button';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useSellerProfile } from '@/lib/crm/catalog';
import { useDealMutations, useDealPipelines } from '@/lib/crm/deals';
import { emptyLine, lineFromItem, linesProblems, mapLineErrors, previewTotals, toLineInputs, type LineDraft } from '@/lib/crm/lines';
import { formErrorMessage, focusFirstInvalid, serverFieldErrors } from '@/lib/crm/ui/errors';
import { FormGrid, FormSection, OwnerSelect } from '@/lib/crm/ui/fields';
import { AccountPicker, ContactPicker, LeadPicker } from '@/lib/crm/ui/pickers';
import type { PickerOption } from '@/lib/crm/ui/record-picker';
import { CoreFieldsInvalid, CrmFormSheet, CrmRecordForm } from '@/lib/crm/ui/record-form';
import { useCan, useMe } from '@/lib/session/session';

export interface DealDefaults {
  title?: string;
  account?: PickerOption | null;
  contact?: PickerOption | null;
  lead?: PickerOption | null;
  stageId?: string;
  valueInr?: number;
}

interface Draft {
  title: string;
  value: string;
  stageId: string;
  ownerId: string | null;
  account: PickerOption | null;
  contact: PickerOption | null;
  lead: PickerOption | null;
  expectedClose: string;
  probability: string;
  description: string;
  lostReason: string;
  lines: LineDraft[];
  withProducts: boolean;
}

const dateOnly = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

/** Create or edit a deal: title, value or products, stage, owner, account, contact, lead, close date, probability. */
export function DealFormSheet({ open, onOpenChange, deal, defaults = {}, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; deal?: Deal; defaults?: DealDefaults; onSaved?: (d: Deal) => void }) {
  const formId = useId().replace(/:/g, '');
  const me = useMe();
  const m = useDealMutations();
  const pipelines = useDealPipelines();
  const seller = useSellerProfile();
  const canAssign = useCan('leads.assign');
  const pipeline = useMemo(() => (deal ? pipelines.data?.items.find((p) => p.id === deal.pipelineId) : (pipelines.data?.items.find((p) => p.isDefault) ?? pipelines.data?.items[0])), [pipelines.data, deal]);
  const [draft, setDraft] = useState<Draft>(() => ({
    title: deal?.title ?? defaults.title ?? '',
    value: deal ? String(deal.valueInr) : defaults.valueInr ? String(defaults.valueInr) : '',
    stageId: deal?.stageId ?? defaults.stageId ?? '',
    ownerId: deal ? (deal.owner?.id ?? null) : (me?.user.id ?? null),
    account: deal?.account ? { id: deal.account.id, label: deal.account.name } : (defaults.account ?? null),
    contact: deal?.contact ? { id: deal.contact.id, label: deal.contact.name } : (defaults.contact ?? null),
    lead: deal?.lead ? { id: deal.lead.id, label: deal.lead.name } : (defaults.lead ?? null),
    expectedClose: dateOnly(deal?.expectedCloseAt),
    probability: deal?.probabilityOverride !== null && deal?.probabilityOverride !== undefined ? String(deal.probabilityOverride) : '',
    description: deal?.description ?? '',
    lostReason: deal?.lostReason ?? '',
    lines: deal?.lines.length ? deal.lines.map(lineFromItem) : [emptyLine()],
    withProducts: !!deal?.lines.length,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setFormError(null);
  };
  const stages = pipeline?.stages ?? [];
  const stageId = draft.stageId || stages.find((s) => s.type === 'open')?.id || '';
  const stage = stages.find((s) => s.id === stageId);
  const sellerState = seller.data?.stateCode ?? null;
  const preview = useMemo(() => previewTotals(draft.lines, sellerState, sellerState), [draft.lines, sellerState]);
  const lineValue = Math.round(preview.totals.taxablePaise / 100);

  const onSubmit = async (customFields: CustomFieldValues) => {
    const e: Record<string, string> = {};
    if (!draft.title.trim()) e.title = 'Enter a title, for example the account and what they buy.';
    if (!draft.withProducts && draft.value.trim() && !/^\d+$/.test(draft.value.replace(/[,\s₹]/g, ''))) e.valueInr = 'Enter the value in whole rupees.';
    if (draft.probability.trim() && !(/^\d+$/.test(draft.probability) && Number(draft.probability) <= 100)) e.probability = 'Enter 0 to 100.';
    if (draft.withProducts) Object.assign(e, linesProblems(draft.lines));
    setErrors(e);
    if (Object.keys(e).length) {
      setFormError(Object.keys(e).length === 1 ? 'Fix the highlighted field to save.' : `Fix the ${Object.keys(e).length} highlighted fields to save.`);
      focusFirstInvalid(formId);
      throw new CoreFieldsInvalid();
    }
    const body: DealUpdate = {
      title: draft.title.trim(),
      valueInr: draft.withProducts ? lineValue : Number(draft.value.replace(/[,\s₹]/g, '') || 0),
      stageId: stageId || undefined,
      accountId: draft.account?.id ?? null,
      contactId: draft.contact?.id ?? null,
      leadId: draft.lead?.id ?? null,
      expectedCloseAt: draft.expectedClose ? new Date(`${draft.expectedClose}T12:00:00+05:30`).toISOString() : null,
      probability: draft.probability.trim() ? Number(draft.probability) : null,
      description: draft.description.trim() || null,
      lostReason: stage?.type === 'lost' ? draft.lostReason.trim() || null : null,
      lines: draft.withProducts ? toLineInputs(draft.lines) : [],
      ...(canAssign || !deal ? { ownerId: draft.ownerId } : {}),
    };
    const saved = deal
      ? await m.update.mutateAsync({ id: deal.id, patch: { ...body, ...(Object.keys(customFields).length ? { customFields } : {}), expectedVersion: deal.version } })
      : await m.create.mutateAsync({ ...body, title: body.title!, pipelineId: pipeline?.id, customFields } as Parameters<typeof m.create.mutateAsync>[0]);
    toast.success(deal ? 'Deal saved' : `Deal ${saved.title} created`);
    onSaved?.(saved);
    onOpenChange(false);
  };

  const onServerError = (err: unknown) => {
    setErrors(mapLineErrors(serverFieldErrors(err), draft.lines));
    setFormError(formErrorMessage(err));
    focusFirstInvalid(formId);
    return true;
  };

  return (
    <CrmFormSheet open={open} onOpenChange={onOpenChange} title={deal ? `Edit ${deal.title}` : 'New deal'} formId={formId} submitLabel={deal ? 'Save changes' : 'Create deal'} submitting={m.create.isPending || m.update.isPending}>
      <CrmRecordForm
        formId={formId}
        target="deal"
        mode={deal ? 'update' : 'create'}
        initialCustom={deal?.customFields}
        onSubmit={onSubmit}
        onServerError={onServerError}
        formError={formError}
        core={
          <div className="flex flex-col gap-6">
            <FormSection title="Deal">
              <FormGrid>
                <FormField label="Title" required error={errors.title} className="sm:col-span-2">
                  <Input value={draft.title} onChange={(e) => set({ title: e.target.value })} />
                </FormField>
                <FormField label="Stage" error={errors.stageId} hint={stage ? `Win probability ${stage.probability}%` : undefined}>
                  <NativeSelect value={stageId} disabled={!stages.length} onChange={(e) => set({ stageId: e.target.value })}>
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                {draft.withProducts ? (
                  <FormField label="Value" hint="Sum of the product lines before GST">
                    <Input value={formatInr(lineValue)} readOnly />
                  </FormField>
                ) : (
                  <FormField label="Value (₹, before GST)" error={errors.valueInr}>
                    <Input inputMode="numeric" value={draft.value} onChange={(e) => set({ value: e.target.value })} />
                  </FormField>
                )}
                <FormField label="Expected close">
                  <Input type="date" value={draft.expectedClose} onChange={(e) => set({ expectedClose: e.target.value })} />
                </FormField>
                <FormField label="Probability override (%)" error={errors.probability} hint="Empty = the stage probability">
                  <Input inputMode="numeric" value={draft.probability} maxLength={3} onChange={(e) => set({ probability: e.target.value.replace(/\D/g, '') })} />
                </FormField>
                {(canAssign || !deal) && (
                  <FormField label="Owner">
                    <OwnerSelect value={draft.ownerId} onChange={(ownerId) => set({ ownerId })} disabled={!canAssign && !!deal} />
                  </FormField>
                )}
                <FormField label="Account">
                  <AccountPicker value={draft.account} onChange={(account) => set({ account, contact: account?.id === draft.account?.id ? draft.contact : null })} />
                </FormField>
                <FormField label="Contact">
                  <ContactPicker accountId={draft.account?.id} value={draft.contact} onChange={(contact) => set({ contact })} />
                </FormField>
                <FormField label="Lead">
                  <LeadPicker value={draft.lead} onChange={(lead) => set({ lead })} />
                </FormField>
                {stage?.type === 'lost' && (
                  <FormField label="Lost reason" className="sm:col-span-2">
                    <Input value={draft.lostReason} maxLength={300} onChange={(e) => set({ lostReason: e.target.value })} />
                  </FormField>
                )}
                <FormField label="Description" className="sm:col-span-2">
                  <Textarea rows={3} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
                </FormField>
              </FormGrid>
            </FormSection>
            <FormSection title="Products" description="Optional. With products, the deal value is the sum of the lines before GST.">
              {draft.withProducts ? (
                <>
                  <LineItemsEditor lines={draft.lines} onChange={(lines) => set({ lines })} amounts={mapAmounts(draft.lines, preview.lines)} errors={errors} priceList={null} taxMode={preview.totals.taxMode} />
                  <Button variant="ghost" className="w-max" onClick={() => set({ withProducts: false, lines: [emptyLine()], value: String(lineValue) })}>
                    Remove products and enter a value
                  </Button>
                </>
              ) : (
                <Button className="w-max" onClick={() => set({ withProducts: true })}>
                  <Package aria-hidden />
                  Add products
                </Button>
              )}
            </FormSection>
          </div>
        }
      />
    </CrmFormSheet>
  );
}

/** Line amounts aligned to the draft rows (blank rows have none). */
export function mapAmounts<T>(lines: readonly LineDraft[], computed: readonly T[]): Array<T | undefined> {
  let k = 0;
  return lines.map((l) => (!l.productId && !l.name.trim() && !l.unitPrice.trim() && !l.hsnSac.trim() ? undefined : computed[k++]));
}
