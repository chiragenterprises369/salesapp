'use client';

import { useState } from 'react';
import { Checkbox } from '@/components/leads/primitives/checkbox';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { formErrorMessage } from './errors';

export interface MergeCandidate {
  id: string;
  name: string;
  meta: string;
}

/**
 * Merge duplicates into the record being viewed (primary). Unlisted fields keep the primary's value;
 * empty primary fields are filled from the duplicates. Leads, deals, documents and meetings move over.
 */
export function MergeDialog({
  open,
  onOpenChange,
  noun,
  primaryName,
  candidates,
  onMerge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noun: 'contact' | 'account';
  primaryName: string;
  candidates: readonly MergeCandidate[];
  onMerge: (duplicateIds: string[]) => Promise<unknown>;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates.map((c) => c.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!picked.size) return setError(`Pick at least one ${noun} to merge.`);
    setBusy(true);
    setError(null);
    try {
      await onMerge([...picked]);
      toast.success(`${picked.size} ${picked.size === 1 ? noun : `${noun}s`} merged into ${primaryName}`);
      onOpenChange(false);
    } catch (e) {
      setError(formErrorMessage(e, 'The merge did not finish. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Merge duplicates into {primaryName}</DialogTitle>
          <DialogDescription>
            {primaryName} keeps its values; empty fields are filled from the duplicates. Their leads, deals, quotations, invoices and meetings move to {primaryName}. Merged {noun}s are removed.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="flex flex-col gap-2">
            {candidates.map((c) => (
              <li key={c.id} className="flex items-start gap-2 rounded-md border border-border px-3 py-2">
                <Checkbox
                  id={`merge-${c.id}`}
                  className="mt-0.5"
                  checked={picked.has(c.id)}
                  onCheckedChange={(v) => {
                    const next = new Set(picked);
                    if (v === true) next.add(c.id);
                    else next.delete(c.id);
                    setPicked(next);
                  }}
                />
                <label htmlFor={`merge-${c.id}`} className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-fg">{c.name}</span>
                  <span className="block truncate text-xs text-muted-strong">{c.meta}</span>
                </label>
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger-text">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={busy}>Cancel</Button>
          </DialogClose>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Merge {picked.size || ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
