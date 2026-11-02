'use client';

import { formatInr, labelOf, type LeadFilters, type LeadListItem } from '@vistar/shared';
import { Search } from 'lucide-react';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { isApiRequestError } from '@/lib/api-error';
import { useLabels } from '@/lib/customization';
import { useLeadsList, useUpdateLead } from '@/lib/leads/data';
import { firstName } from '../state/reducer';

const SORT = { sort: 'createdAt', dir: 'desc' } as const;

/**
 * Assign a lead to the person (PATCH /leads/{id} { ownerId }, needs leads.assign). Unassigned leads
 * first; search covers name, company and phone. The socket echoes `lead.assigned`, so the parcel flies
 * to their desk on every open floor.
 */
export function AssignLeadDialog({
  person,
  open,
  onOpenChange,
  onAssigned,
}: {
  person: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned?: (lead: LeadListItem, fromUserId: string | null) => void;
}) {
  const labels = useLabels();
  const lead = labelOf(labels, 'lead', { lower: true });
  const leads = labelOf(labels, 'lead', { plural: true, lower: true });
  const [q, setQ] = useState('');
  const [unassignedOnly, setUnassignedOnly] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const deferredQ = useDeferredValue(q.trim());
  const filters = useMemo<LeadFilters>(() => ({ ...(deferredQ ? { q: deferredQ } : {}), ...(unassignedOnly ? { ownerId: ['unassigned'] } : {}) }), [deferredQ, unassignedOnly]);
  const list = useLeadsList(filters, SORT, 20);
  const update = useUpdateLead();
  const name = useId();
  const items = (list.data?.pages[0]?.items ?? []).filter((l) => l.owner?.id !== person.id);
  const chosen = items.find((l) => l.id === picked) ?? null;

  const assign = async () => {
    if (!chosen) return;
    try {
      await update.mutateAsync({ id: chosen.id, patch: { ownerId: person.id } });
      toast.success(`${chosen.name} assigned to ${person.name}`);
      onAssigned?.(chosen, chosen.owner?.id ?? null);
      setPicked(null);
      onOpenChange(false);
    } catch (e) {
      toast.error(isApiRequestError(e) ? e.message : `The ${lead} was not assigned. Try again.`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !update.isPending && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>
            Assign a {lead} to {firstName(person.name)}
          </DialogTitle>
          <DialogDescription>They get it on their desk right away and a notification on the app.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
              <Input
                aria-label={`Search ${leads}`}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPicked(null);
                }}
                placeholder="Name, company or phone"
                className="pl-8"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-fg-secondary">
              <input
                type="checkbox"
                checked={unassignedOnly}
                onChange={(e) => {
                  setUnassignedOnly(e.target.checked);
                  setPicked(null);
                }}
                className="size-4 accent-accent"
              />
              Unassigned only
            </label>
          </div>
          {list.isPending ? (
            <div className="space-y-2" aria-busy="true" aria-label={`Loading ${leads}`}>
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : list.isError ? (
            <div role="alert" className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <span className="text-danger-text">The {leads} did not load.</span>
              <Button size="sm" onClick={() => void list.refetch()}>
                Try again
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="rounded-md border border-dashed border-border-strong px-3 py-6 text-center text-sm text-muted">
              {unassignedOnly ? `No unassigned ${leads}${deferredQ ? ' match' : ''}. Clear "Unassigned only" to move one from a teammate.` : `No ${leads} match.`}
            </p>
          ) : (
            <fieldset className="max-h-80 space-y-0.5 overflow-y-auto">
              <legend className="sr-only">{`Pick a ${lead}`}</legend>
              {items.map((l) => (
                <label key={l.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 hover:bg-surface-2 has-[:checked]:bg-accent-soft">
                  <input type="radio" name={name} value={l.id} checked={picked === l.id} onChange={() => setPicked(l.id)} className="accent-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{l.name}</span>
                    <span className="block truncate text-xs text-muted-strong">
                      {[l.companyName, l.city, l.owner ? `Owner: ${l.owner.name}` : 'Unassigned'].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {l.valueInr > 0 && <span className="tabular shrink-0 text-xs text-muted-strong">{formatInr(l.valueInr, { compact: true })}</span>}
                </label>
              ))}
            </fieldset>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} disabled={update.isPending}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!chosen} loading={update.isPending} onClick={() => void assign()}>
            Assign {lead}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
