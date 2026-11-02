'use client';

import { GST_RATES, hsnSacProblem, PRODUCT_UNIT_LABELS, PRODUCT_UNITS, SKU_RE, type GstRate, type Product, type ProductKind, type ProductUnit } from '@vistar/shared';
import { useId, useState, type FormEvent } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Switch } from '@/components/common/switch';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useProductMutations } from '@/lib/crm/catalog';
import { rupeesText } from '@/lib/crm/lines';
import { formErrorMessage, focusFirstInvalid, serverFieldErrors } from '@/lib/crm/ui/errors';
import { FormGrid, parseRupees } from '@/lib/crm/ui/fields';
import { CrmFormSheet } from '@/lib/crm/ui/record-form';

interface Draft {
  sku: string;
  name: string;
  description: string;
  kind: ProductKind;
  hsnSac: string;
  unit: ProductUnit;
  gstRate: GstRate;
  price: string;
  active: boolean;
}

/** Create or edit a product or service: SKU, HSN (goods) or SAC (services), unit, GST rate, price before GST. */
export function ProductFormSheet({ open, onOpenChange, product }: { open: boolean; onOpenChange: (o: boolean) => void; product?: Product }) {
  const formId = useId().replace(/:/g, '');
  const m = useProductMutations();
  const [draft, setDraft] = useState<Draft>(() => ({
    sku: product?.sku ?? '',
    name: product?.name ?? '',
    description: product?.description ?? '',
    kind: product?.kind ?? 'goods',
    hsnSac: product?.hsnSac ?? '',
    unit: product?.unit ?? 'NOS',
    gstRate: product?.gstRate ?? 18,
    price: product ? rupeesText(product.unitPricePaise) : '',
    active: product?.active ?? true,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setFormError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!SKU_RE.test(draft.sku.trim())) errs.sku = 'Use 1-40 letters, digits, ".", "_", "/" or "-".';
    if (!draft.name.trim()) errs.name = 'Enter the product name.';
    const code = draft.hsnSac.trim();
    const problem = code ? hsnSacProblem(draft.kind, code) : draft.kind === 'service' ? 'Enter the 6-digit SAC code.' : 'Enter the HSN code.';
    if (problem) errs.hsnSac = `${problem}.`.replace('..', '.');
    const paise = parseRupees(draft.price);
    if (paise === null) errs.unitPricePaise = 'Enter the price in rupees, up to 2 decimals.';
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError(Object.keys(errs).length === 1 ? 'Fix the highlighted field to save.' : `Fix the ${Object.keys(errs).length} highlighted fields to save.`);
      focusFirstInvalid(formId);
      return;
    }
    const body = { sku: draft.sku.trim(), name: draft.name.trim(), description: draft.description.trim() || null, kind: draft.kind, hsnSac: code, unit: draft.unit, gstRate: draft.gstRate, unitPricePaise: paise!, active: draft.active };
    try {
      if (product) await m.update.mutateAsync({ id: product.id, patch: { ...body, expectedUpdatedAt: product.updatedAt } });
      else await m.create.mutateAsync(body);
      toast.success(product ? 'Product saved' : `${body.name} added`);
      onOpenChange(false);
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFormError(formErrorMessage(err));
      focusFirstInvalid(formId);
    }
  };

  return (
    <CrmFormSheet open={open} onOpenChange={onOpenChange} size="lg" title={product ? `Edit ${product.name}` : 'New product'} description="Prices exclude GST. Quotations and invoices add GST at the rate set here." formId={formId} submitLabel={product ? 'Save changes' : 'Add product'} submitting={m.create.isPending || m.update.isPending}>
      <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        {formError && (
          <p role="alert" className="rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-sm text-status-red-fg">
            {formError}
          </p>
        )}
        <FormGrid>
          <FormField label="Name" required error={errors.name} className="sm:col-span-2">
            <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </FormField>
          <FormField label="SKU" required error={errors.sku} hint="Your item code; unique in the workspace">
            <Input value={draft.sku} maxLength={40} onChange={(e) => set({ sku: e.target.value })} />
          </FormField>
          <FormField label="Type">
            <NativeSelect value={draft.kind} onChange={(e) => set({ kind: e.target.value as ProductKind })}>
              <option value="goods">Goods (HSN code)</option>
              <option value="service">Service (SAC code)</option>
            </NativeSelect>
          </FormField>
          <FormField label={draft.kind === 'service' ? 'SAC code' : 'HSN code'} required error={errors.hsnSac} hint={draft.kind === 'service' ? '6 digits starting with 99' : '4, 6 or 8 digits'}>
            <Input value={draft.hsnSac} inputMode="numeric" maxLength={8} onChange={(e) => set({ hsnSac: e.target.value.replace(/\D/g, '') })} />
          </FormField>
          <FormField label="Unit">
            <NativeSelect value={draft.unit} onChange={(e) => set({ unit: e.target.value as ProductUnit })}>
              {PRODUCT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u} · {PRODUCT_UNIT_LABELS[u]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="GST rate">
            <NativeSelect value={String(draft.gstRate)} onChange={(e) => set({ gstRate: Number(e.target.value) as GstRate })}>
              {GST_RATES.map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Price (₹, before GST)" required error={errors.unitPricePaise}>
            <Input value={draft.price} inputMode="decimal" onChange={(e) => set({ price: e.target.value })} />
          </FormField>
          <FormField label="Description" className="sm:col-span-2">
            <Textarea rows={3} value={draft.description} maxLength={2000} onChange={(e) => set({ description: e.target.value })} />
          </FormField>
        </FormGrid>
        <label className="flex items-center gap-3 text-sm text-fg">
          <Switch checked={draft.active} onCheckedChange={(active) => set({ active })} />
          Active (inactive products cannot be added to new documents)
        </label>
      </form>
    </CrmFormSheet>
  );
}
