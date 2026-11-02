'use client';

import { formatInr, formatPaise, stageTone, type Stage } from '@vistar/shared';
import { CalendarPlus, Check, FileText, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/leads/primitives/menu';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FormField, Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { COLUMN_TINT, STAGE_DOT } from '@/features/pipeline/tones';
import { cn } from '@/lib/cn';
import { DEAL_STATUS, formatDateIn } from '@/lib/crm/format';
import { useDeal, useDealMutations, useDealPipelines, useDealRelated, useDealTimeline, useMoveDeal } from '@/lib/crm/deals';
import { useCrmRealtime } from '@/lib/crm/realtime';
import { ConfirmDialog } from '@/lib/crm/ui/confirm-dialog';
import { CrmTimeline } from '@/lib/crm/ui/crm-timeline';
import { CustomFieldsCard } from '@/lib/crm/ui/custom-fields-card';
import { DetailError, DetailGrid, DetailHeader, DetailSection, DetailSkeleton, FieldList } from '@/lib/crm/ui/detail-layout';
import { RelatedPanels } from '@/lib/crm/ui/related';
import { useCan, useMe } from '@/lib/session/session';
import { DealFormSheet } from './deal-form';

export function DealDetailPage({ id }: { id: string }) {
  return (
    <RequirePermission anyOf={['deals.read']}>
      <DealDetail id={id} />
    </RequirePermission>
  );
}

function DealDetail({ id }: { id: string }) {
  useCrmRealtime();
  const router = useRouter();
  const me = useMe();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const q = useDeal(id);
  const related = useDealRelated(id);
  const timeline = useDealTimeline(id);
  const pipelines = useDealPipelines();
  const m = useDealMutations();
  const move = useMoveDeal();
  const canUpdate = useCan('deals.update');
  const canDelete = useCan('deals.delete');
  const canQuote = useCan('quotations.create');
  const canMeet = useCan('calendar.create');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [lostStage, setLostStage] = useState<Stage | null>(null);
  const [lostReason, setLostReason] = useState('');

  if (q.isPending) return <DetailSkeleton />;
  if (q.isError) return <DetailError error={q.error} onRetry={() => void q.refetch()} backHref="/app/deals" backLabel="Back to deals" noun="deal" />;
  const d = q.data;
  const pipeline = pipelines.data?.items.find((p) => p.id === d.pipelineId);
  const stages = pipeline?.stages ?? [];
  const stage = stages.find((s) => s.id === d.stageId);
  const docQuery = [`dealId=${d.id}`, d.account ? `accountId=${d.account.id}` : '', d.contact ? `contactId=${d.contact.id}` : ''].filter(Boolean).join('&');

  const moveTo = (s: Stage, reason?: string | null) =>
    move.mutate(
      { deal: d, move: { stageId: s.id, lostReason: reason ?? null, expectedVersion: d.version } },
      {
        onSuccess: () => {
          toast.success(`${d.title} moved to ${s.name}`);
          void q.refetch();
        },
      },
    );

  const lineTotals = d.lines.reduce((acc, l) => ({ taxable: acc.taxable + l.taxablePaise, tax: acc.tax + l.cgstPaise + l.sgstPaise + l.igstPaise, total: acc.total + l.totalPaise }), { taxable: 0, tax: 0, total: 0 });

  return (
    <div className="flex w-full min-w-0 flex-col pb-6">
      <DetailHeader
        backHref="/app/deals"
        backLabel="Deals"
        title={d.title}
        subtitle={[d.account?.name, d.contact?.name].filter(Boolean).join(' · ') || undefined}
        meta={
          <>
            <Chip tone={DEAL_STATUS[d.status].tone}>{DEAL_STATUS[d.status].label}</Chip>
            <Chip tone="indigo">{formatInr(d.valueInr)}</Chip>
          </>
        }
        actions={
          <>
            {canQuote && (
              <Button asChild>
                <Link href={`/app/quotations/new?${docQuery}`}>
                  <FileText aria-hidden />
                  New quotation
                </Link>
              </Button>
            )}
            {canUpdate && (
              <Button variant="primary" onClick={() => setEditing(true)}>
                <Pencil aria-hidden />
                Edit
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" aria-label="More actions">
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {canMeet && (
                  <DropdownMenuItem onSelect={() => router.push(`/app/calendar?new=1&${docQuery}`)}>
                    <CalendarPlus aria-hidden />
                    Schedule meeting
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem destructive onSelect={() => setDeleting(true)}>
                    <Trash2 aria-hidden />
                    Delete deal
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      {stages.length > 0 && (
        <nav aria-label="Deal stage" className="mb-4 overflow-x-auto">
          <ol className="flex min-w-max gap-1.5">
            {stages.map((s) => {
              const current = s.id === d.stageId;
              const tone = stageTone(s);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={!canUpdate || current || move.isPending}
                    aria-current={current ? 'step' : undefined}
                    onClick={() => (s.type === 'lost' ? setLostStage(s) : moveTo(s))}
                    className={cn(
                      'focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium disabled:cursor-default',
                      current ? cn(COLUMN_TINT[tone], 'text-fg') : 'border-border bg-surface text-fg-secondary hover:bg-surface-2 disabled:opacity-100',
                    )}
                  >
                    {current ? <Check aria-hidden className="size-3.5" /> : <span aria-hidden className={cn('size-2 rounded-full', STAGE_DOT[tone])} />}
                    {s.name}
                    <span className="text-2xs text-muted-strong">{s.probability}%</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      <DetailGrid
        main={
          <>
            <DetailSection title="Details">
              <FieldList
                columns={3}
                items={[
                  { label: 'Value (before GST)', value: formatInr(d.valueInr) },
                  { label: 'Probability', value: `${d.probability}%${d.probabilityOverride !== null ? ' (set on the deal)' : stage ? ` (stage ${stage.name})` : ''}` },
                  { label: 'Weighted value', value: formatInr(d.weightedValueInr) },
                  { label: 'Expected close', value: formatDateIn(d.expectedCloseAt, tz) },
                  { label: 'Owner', value: d.owner?.name ?? 'Unassigned' },
                  { label: 'Closed', value: formatDateIn(d.closedAt, tz) },
                  { label: 'Account', value: d.account ? <Link className="focus-ring rounded-sm hover:underline" href={`/app/accounts/${d.account.id}`}>{d.account.name}</Link> : null },
                  { label: 'Contact', value: d.contact ? <Link className="focus-ring rounded-sm hover:underline" href={`/app/contacts/${d.contact.id}`}>{d.contact.name}</Link> : null },
                  { label: 'Lead', value: d.lead ? <Link className="focus-ring rounded-sm hover:underline" href={`/app/leads/${d.lead.id}`}>{d.lead.name}</Link> : null },
                  ...(d.status === 'lost' ? [{ label: 'Lost reason', value: d.lostReason, wide: true }] : []),
                  { label: 'Description', value: d.description ? <span className="whitespace-pre-wrap">{d.description}</span> : null, wide: true },
                ]}
              />
            </DetailSection>
            <DetailSection
              title={`Products (${d.lines.length})`}
              actions={
                canUpdate && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                    {d.lines.length ? 'Edit products' : 'Add products'}
                  </Button>
                )
              }
            >
              {d.lines.length === 0 ? (
                <p className="text-sm text-muted-strong">No products on this deal. The value is entered by hand.</p>
              ) : (
                <Table aria-label="Products on this deal">
                  <TableHeader sticky={false}>
                    <TableRow className="hover:bg-surface">
                      <TableHead>Item</TableHead>
                      <TableHead>HSN/SAC</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Taxable</TableHead>
                      <TableHead className="text-right">GST</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.lines.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="whitespace-normal">
                          {l.productId ? <span className="font-medium">{l.name}</span> : l.name}
                        </TableCell>
                        <TableCell>{l.hsnSac}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {l.quantity} {l.unit}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatPaise(l.unitPricePaise)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPaise(l.taxablePaise)}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.gstRate}%</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPaise(l.totalPaise)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="hover:bg-surface">
                      <TableCell colSpan={4} className="text-right font-medium">
                        Total
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatPaise(lineTotals.taxable)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPaise(lineTotals.tax)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatPaise(lineTotals.total)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </DetailSection>
            <CustomFieldsCard target="deal" values={d.customFields} canUpdate={canUpdate} onSave={(customFields) => m.update.mutateAsync({ id: d.id, patch: { customFields, expectedVersion: d.version } })} />
            <DetailSection title="Timeline">
              <CrmTimeline query={timeline} canAddNote={canUpdate} onAddNote={(body) => m.addNote.mutateAsync({ id: d.id, body })} />
            </DetailSection>
          </>
        }
        side={
          <RelatedPanels
            data={related.data}
            loading={related.isPending}
            error={related.isError}
            onRetry={() => void related.refetch()}
            sections={['quotations', 'invoices', 'meetings', 'leads']}
            actions={{
              quotations: canQuote && (
                <Button size="sm" variant="ghost" asChild>
                  <Link href={`/app/quotations/new?${docQuery}`}>New</Link>
                </Button>
              ),
              meetings: canMeet && (
                <Button size="sm" variant="ghost" asChild>
                  <Link href={`/app/calendar?new=1&${docQuery}`}>Schedule</Link>
                </Button>
              ),
            }}
          />
        }
      />
      {editing && <DealFormSheet open onOpenChange={setEditing} deal={d} />}
      {lostStage && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setLostStage(null)}
          title={`Mark ${d.title} as lost?`}
          description="Say why the deal was lost. Reports group lost deals by this reason."
          confirmLabel="Mark as lost"
          tone="primary"
          onConfirm={() => {
            moveTo(lostStage, lostReason.trim() || null);
            setLostStage(null);
            setLostReason('');
          }}
        >
          <FormField label="Lost reason" hint="Optional">
            <Input autoFocus value={lostReason} maxLength={300} onChange={(e) => setLostReason(e.target.value)} />
          </FormField>
        </ConfirmDialog>
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${d.title}?`}
        description="Quotations and invoices stay; their link to the deal is removed. This cannot be undone."
        confirmLabel="Delete deal"
        loading={m.remove.isPending}
        onConfirm={() =>
          void m.remove.mutateAsync(d.id).then(
            () => {
              toast.success(`${d.title} deleted`);
              router.push('/app/deals');
            },
            (e: unknown) => toast.error(e instanceof Error ? e.message : 'The deal was not deleted. Try again.'),
          )
        }
      />
    </div>
  );
}
