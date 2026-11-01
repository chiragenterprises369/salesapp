'use client';

import { useQuery } from '@tanstack/react-query';
import { WORKFLOW_TEMPLATES, type Lead, type LeadListItem } from '@vistar/shared';
import { GitMerge, Play } from 'lucide-react';
import { RadioGroup } from 'radix-ui';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { getLeadsSource, leadKeys, useBulkLeads } from '@/lib/leads/data';
import { formatCreated, formatPhone, StageChip } from '@/components/leads/lead-meta';
import { Checkbox } from '@/components/leads/primitives/checkbox';

/** "Run workflow": pick an active workflow and start it for this lead (mock: toast + timeline entry). */
export function RunWorkflowDialog({
  lead,
  open,
  onOpenChange,
  onStarted,
}: {
  lead: Lead;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onStarted: (name: string) => void;
}) {
  const [key, setKey] = useState(WORKFLOW_TEMPLATES[0]!.key);
  const [busy, setBusy] = useState(false);
  const wf = WORKFLOW_TEMPLATES.find((w) => w.key === key) ?? WORKFLOW_TEMPLATES[0]!;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Run workflow for {lead.name}</DialogTitle>
          <DialogDescription>
            Only active workflows are listed. Steps appear on the timeline as they run.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <RadioGroup.Root
            value={key}
            onValueChange={setKey}
            aria-label="Workflow"
            className="flex flex-col gap-1.5"
            loop
          >
            {WORKFLOW_TEMPLATES.map((w) => (
              <RadioGroup.Item
                key={w.key}
                value={w.key}
                className={cn(
                  'focus-ring flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors',
                  w.key === key
                    ? 'border-status-indigo-border bg-accent-soft'
                    : 'border-border hover:bg-surface-2',
                )}
              >
                <span
                  className={cn(
                    'text-sm font-medium',
                    w.key === key ? 'text-accent-soft-fg' : 'text-fg',
                  )}
                >
                  {w.name}
                </span>
                <span className={cn('text-xs', w.key === key ? 'text-muted-strong' : 'text-muted')}>
                  {w.description}
                </span>
              </RadioGroup.Item>
            ))}
          </RadioGroup.Root>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await new Promise((r) => setTimeout(r, 350));
              setBusy(false);
              onStarted(wf.name);
              toast.success(`Started "${wf.name}" for ${lead.name}`);
              onOpenChange(false);
            }}
          >
            <Play aria-hidden />
            Run workflow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const digits = (p: string | null) => (p ? p.replace(/\D/g, '').slice(-10) : '');

/** Possible duplicates by phone, then by name (mock: client-side over the leads source). */
function useDuplicates(lead: Lead, enabled: boolean) {
  return useQuery({
    queryKey: [...leadKeys.detail(lead.id), 'duplicates'],
    enabled,
    queryFn: async () => {
      const src = getLeadsSource();
      const [byPhone, byName] = await Promise.all([
        lead.phone
          ? src.list({ q: digits(lead.phone), limit: 20, sort: 'createdAt', dir: 'desc' })
          : Promise.resolve({ items: [] as LeadListItem[] }),
        src.list({ q: lead.name, limit: 20, sort: 'createdAt', dir: 'desc' }),
      ]);
      const out = new Map<string, LeadListItem & { reason: string }>();
      byPhone.items
        .filter((l) => l.id !== lead.id && digits(l.phone) === digits(lead.phone))
        .forEach((l) => out.set(l.id, { ...l, reason: 'Same phone' }));
      byName.items
        .filter(
          (l) =>
            l.id !== lead.id && l.name.toLowerCase() === lead.name.toLowerCase() && !out.has(l.id),
        )
        .forEach((l) => out.set(l.id, { ...l, reason: 'Same name' }));
      return [...out.values()];
    },
  });
}

/** "Merge duplicates": pick duplicates to merge into this lead (mock: duplicates are removed). */
export function MergeDialog({
  lead,
  open,
  onOpenChange,
  onMerged,
}: {
  lead: Lead;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onMerged: (ids: string[]) => void;
}) {
  const dupes = useDuplicates(lead, open);
  const bulk = useBulkLeads();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const items = dupes.data ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setPicked(new Set());
        onOpenChange(o);
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Merge duplicates into {lead.name}</DialogTitle>
          <DialogDescription>
            Timeline, tasks and conversations move to this lead. This lead keeps its own field
            values.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {dupes.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : dupes.isError ? (
            <div role="alert" className="flex flex-col items-start gap-2 text-sm">
              <p className="text-danger-text">Duplicates did not load.</p>
              <Button size="sm" onClick={() => void dupes.refetch()}>
                Try again
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              No possible duplicates found by phone or name.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {items.map((d) => (
                <li key={d.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
                    <Checkbox
                      checked={picked.has(d.id)}
                      onCheckedChange={(c) =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (c === true) n.add(d.id);
                          else n.delete(d.id);
                          return n;
                        })
                      }
                      aria-label={`Merge ${d.name}, created ${formatCreated(d.createdAt)}`}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{d.name}</span>
                      <span className="truncate text-xs text-muted">
                        {d.companyName ?? 'No company'} · {formatPhone(d.phone)} · created{' '}
                        {formatCreated(d.createdAt)}
                      </span>
                    </span>
                    <span className="text-2xs text-muted">{d.reason}</span>
                    <StageChip stageId={d.stageId} />
                  </label>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            disabled={picked.size === 0}
            loading={bulk.isPending}
            onClick={async () => {
              const ids = [...picked];
              try {
                await bulk.mutateAsync({ action: 'delete', leadIds: ids });
                onMerged(ids);
                toast.success(
                  `Merged ${ids.length} lead${ids.length === 1 ? '' : 's'} into ${lead.name}`,
                );
                setPicked(new Set());
                onOpenChange(false);
              } catch {
                toast.error('Leads were not merged. Try again.');
              }
            }}
          >
            <GitMerge aria-hidden />
            {picked.size > 0 ? `Merge ${picked.size} lead${picked.size === 1 ? '' : 's'}` : 'Merge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
