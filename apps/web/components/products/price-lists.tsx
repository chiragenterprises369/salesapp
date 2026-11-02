'use client';

import { formatPaise, type PriceList } from '@vistar/shared';
import { ListOrdered, Pencil, Plus, Trash2 } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { Switch } from '@/components/common/switch';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FormField, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { useProducts, usePriceList, usePriceListMutations, usePriceLists } from '@/lib/crm/catalog';
import { formatDay } from '@/lib/crm/format';
import { rupeesText } from '@/lib/crm/lines';
import { ConfirmDialog } from '@/lib/crm/ui/confirm-dialog';
import { formErrorMessage, focusFirstInvalid } from '@/lib/crm/ui/errors';
import { FormGrid, parseRupees } from '@/lib/crm/ui/fields';
import { CrmFormSheet } from '@/lib/crm/ui/record-form';
import { RecordPicker } from '@/lib/crm/ui/record-picker';

/** Price lists: special prices for some products (dealer, distributor, festive). The default list is preselected on new documents. */
export function PriceListsPanel({ canManage }: { canManage: boolean }) {
  const q = usePriceLists();
  const m = usePriceListMutations();
  const [editing, setEditing] = useState<PriceList | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PriceList | null>(null);
  const lists = q.data?.items ?? [];

  if (q.isPending) {
    return (
      <div role="status" aria-label="Loading price lists" className="flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    );
  }
  if (q.isError) return <EmptyState title="Price lists did not load" description="Check your connection, then try again." action={<Button onClick={() => void q.refetch()}>Try again</Button>} />;

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <Button className="w-max" onClick={() => setEditing('new')}>
          <Plus aria-hidden />
          New price list
        </Button>
      )}
      {lists.length === 0 ? (
        <EmptyState icon={<ListOrdered />} title="No price lists yet" description="Create a list for dealer or distributor prices. Products not on a list use their own price." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
          <Table aria-label="Price lists">
            <TableHeader>
              <TableRow className="hover:bg-surface">
                <TableHead>Name</TableHead>
                <TableHead>Valid</TableHead>
                <TableHead className="text-right">Products</TableHead>
                <TableHead>Status</TableHead>
                {canManage && (
                  <TableHead className="w-24">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lists.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">
                    {l.name} {l.isDefault && <Chip tone="indigo">Default</Chip>}
                  </TableCell>
                  <TableCell>{l.validFrom || l.validTo ? `${l.validFrom ? formatDay(l.validFrom) : 'Any time'} – ${l.validTo ? formatDay(l.validTo) : 'no end'}` : 'Always'}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.itemCount}</TableCell>
                  <TableCell>{l.active ? <Chip tone="green">Active</Chip> : <Chip tone="grey">Inactive</Chip>}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${l.name}`} onClick={() => setEditing(l)}>
                        <Pencil aria-hidden />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Delete ${l.name}`} onClick={() => setDeleting(l)}>
                        <Trash2 aria-hidden />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && <PriceListSheet id={editing === 'new' ? null : editing.id} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'price list'}?`}
        description="Documents already made keep their prices. New documents use the product prices."
        confirmLabel="Delete"
        loading={m.remove.isPending}
        onConfirm={() =>
          deleting &&
          void m.remove.mutateAsync(deleting.id).then(
            () => {
              toast.success('Price list deleted');
              setDeleting(null);
            },
            (e: unknown) => toast.error(formErrorMessage(e)),
          )
        }
      />
    </div>
  );
}

interface ItemDraft {
  productId: string;
  name: string;
  sku: string;
  listPrice: number;
  price: string;
}

function PriceListSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const detail = usePriceList(id);
  if (id && detail.isPending) return null;
  return <PriceListForm list={detail.data ?? null} onClose={onClose} />;
}

function PriceListForm({ list, onClose }: { list: PriceList | null; onClose: () => void }) {
  const formId = useId().replace(/:/g, '');
  const m = usePriceListMutations();
  const [name, setName] = useState(list?.name ?? '');
  const [description, setDescription] = useState(list?.description ?? '');
  const [isDefault, setIsDefault] = useState(list?.isDefault ?? false);
  const [active, setActive] = useState(list?.active ?? true);
  const [validFrom, setValidFrom] = useState(list?.validFrom ?? '');
  const [validTo, setValidTo] = useState(list?.validTo ?? '');
  const [items, setItems] = useState<ItemDraft[]>(() => (list?.items ?? []).map((i) => ({ productId: i.productId, name: i.product.name, sku: i.product.sku, listPrice: i.product.unitPricePaise, price: rupeesText(i.unitPricePaise) })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const products = useProducts({ q: q || undefined, active: true }, { limit: 20 });
  const options = (products.data?.pages[0]?.items ?? []).filter((p) => !items.some((i) => i.productId === p.id)).map((p) => ({ id: p.id, label: p.name, meta: `${p.sku} · ${formatPaise(p.unitPricePaise)}` }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Enter a name.';
    if (validFrom && validTo && validTo < validFrom) errs.validTo = 'The end date is before the start date.';
    const parsed = items.map((i, idx) => {
      const p = parseRupees(i.price);
      if (p === null) errs[`items.${idx}`] = `Enter a price for ${i.name}.`;
      return { productId: i.productId, unitPricePaise: p ?? 0 };
    });
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError('Fix the highlighted fields to save.');
      focusFirstInvalid(formId);
      return;
    }
    const body = { name: name.trim(), description: description.trim() || null, isDefault, active, validFrom: validFrom || null, validTo: validTo || null, items: parsed };
    try {
      if (list) await m.update.mutateAsync({ id: list.id, patch: body });
      else await m.create.mutateAsync(body);
      toast.success(list ? 'Price list saved' : `${body.name} created`);
      onClose();
    } catch (err) {
      setFormError(formErrorMessage(err));
    }
  };

  return (
    <CrmFormSheet open onOpenChange={(o) => !o && onClose()} title={list ? `Edit ${list.name}` : 'New price list'} formId={formId} submitLabel={list ? 'Save changes' : 'Create price list'} submitting={m.create.isPending || m.update.isPending}>
      <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
        {formError && (
          <p role="alert" className="rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-sm text-status-red-fg">
            {formError}
          </p>
        )}
        <FormGrid>
          <FormField label="Name" required error={errors.name}>
            <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="Description">
            <Input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <FormField label="Valid from">
            <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </FormField>
          <FormField label="Valid until" error={errors.validTo}>
            <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </FormField>
        </FormGrid>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-3 text-sm text-fg">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            Default list (preselected on new quotations and invoices)
          </label>
          <label className="flex items-center gap-3 text-sm text-fg">
            <Switch checked={active} onCheckedChange={setActive} />
            Active
          </label>
        </div>
        <section aria-labelledby={`${formId}-items`} className="flex flex-col gap-2">
          <h3 id={`${formId}-items`} className="text-sm font-semibold text-fg">
            Products and prices ({items.length})
          </h3>
          <RecordPicker
            value={null}
            onChange={(o) => {
              if (!o) return;
              const p = products.data?.pages[0]?.items.find((x) => x.id === o.id);
              if (p) setItems([...items, { productId: p.id, name: p.name, sku: p.sku, listPrice: p.unitPricePaise, price: rupeesText(p.unitPricePaise) }]);
            }}
            options={options}
            loading={products.isFetching}
            onQueryChange={setQ}
            placeholder="Add a product to this list"
            clearable={false}
          />
          {items.length > 0 && (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {items.map((it, idx) => (
                <li key={it.productId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{it.name}</p>
                    <p className="text-xs text-muted-strong">
                      {it.sku} · product price {formatPaise(it.listPrice)}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-fg-secondary">
                    List price (₹)
                    <Input
                      className="w-32"
                      inputMode="decimal"
                      value={it.price}
                      aria-invalid={errors[`items.${idx}`] ? true : undefined}
                      onChange={(e) => setItems(items.map((x, j) => (j === idx ? { ...x, price: e.target.value } : x)))}
                    />
                  </label>
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove ${it.name}`} onClick={() => setItems(items.filter((_, j) => j !== idx))}>
                    <Trash2 aria-hidden />
                  </Button>
                  {errors[`items.${idx}`] && (
                    <p role="alert" className="w-full text-xs text-danger-text">
                      {errors[`items.${idx}`]}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </form>
    </CrmFormSheet>
  );
}
