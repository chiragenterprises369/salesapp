'use client';

import { formatInr, stageTone, type DealListItem, type Stage, type StageType } from '@vistar/shared';
import { AlertCircle, Columns3, Handshake, Plus, Trash2, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { NativeSelect } from '@/components/common/native-select';
import { PageHeader } from '@/components/common/page-header';
import { useNow } from '@/components/common/use-now';
import { Segmented } from '@/components/dashboard/segmented';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/leads/primitives/menu';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FormField, Input } from '@/components/ui/input';
import { useScopedUserList } from '@/lib/api/directory';
import { ago, DEAL_STATUS, formatDateIn } from '@/lib/crm/format';
import { useDealBoard, useDealMutations, useDealPipelines, useDeals, useMoveDeal, type DealQuery } from '@/lib/crm/deals';
import { flatPages } from '@/lib/crm/parties';
import { useCrmRealtime } from '@/lib/crm/realtime';
import { BulkBar, reportBulkResult } from '@/lib/crm/ui/bulk-bar';
import { ConfirmDialog } from '@/lib/crm/ui/confirm-dialog';
import { CrmTable, type CrmColumn } from '@/lib/crm/ui/crm-table';
import { useListState } from '@/lib/crm/ui/list-state';
import { ClearFilters, ColumnSetsMenu, CrmSearch, FacetFilter, ListToolbar, OwnerFilter } from '@/lib/crm/ui/list-toolbar';
import { useColumnPrefs } from '@/lib/crm/ui/use-column-prefs';
import { useCan, useMe } from '@/lib/session/session';
import { STAGE_DOT } from '@/features/pipeline/tones';
import { cn } from '@/lib/cn';
import { DealFormSheet } from './deal-form';
import { DealsBoard, type BoardMoveRequest } from './deals-board';

type ViewMode = 'board' | 'table';
const useDealsView = create<{ mode: ViewMode; setMode: (m: ViewMode) => void }>()(
  persist((set) => ({ mode: 'board', setMode: (mode) => set({ mode }) }), { name: 'vistar.deals.view', storage: createJSONStorage(() => localStorage), version: 1 }),
);

interface Filters {
  ownerId?: string[];
  status?: StageType[];
  stageId?: string[];
  pipelineId?: string;
}

const STATUS_OPTIONS = (['open', 'won', 'lost'] as const).map((s) => ({ value: s, label: DEAL_STATUS[s].label }));

/** Deals as a board (default) or a table with the same filters; bulk actions in the table. */
export function DealsPage() {
  return (
    <RequirePermission anyOf={['deals.read']}>
      <Deals />
    </RequirePermission>
  );
}

function Deals() {
  useCrmRealtime();
  const me = useMe();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const now = useNow(60_000);
  const mode = useDealsView((s) => s.mode);
  const setMode = useDealsView((s) => s.setMode);
  const list = useListState<Filters>('deals', { filters: { status: ['open'] }, sort: { key: 'updatedAt', dir: 'desc' } });
  const pipelines = useDealPipelines();
  const canCreate = useCan('deals.create');
  const canUpdate = useCan('deals.update');
  const canDelete = useCan('deals.delete');
  const [creating, setCreating] = useState(false);
  const [lostAsk, setLostAsk] = useState<BoardMoveRequest | null>(null);
  const move = useMoveDeal();
  const filters = { q: list.q || undefined, ...list.filters };
  const board = useDealBoard(filters, { enabled: mode === 'board' });
  const tableQuery: DealQuery = { ...filters, sort: list.sort.key as DealQuery['sort'], dir: list.sort.dir };
  const table = useDeals(tableQuery, { enabled: mode === 'table' });
  const rows = flatPages(table.data);
  const pipelineList = pipelines.data?.items ?? [];
  const pipeline = pipelineList.find((p) => p.id === list.filters.pipelineId) ?? pipelineList.find((p) => p.isDefault) ?? pipelineList[0];
  const stages = pipeline?.stages ?? [];

  const doMove = (req: BoardMoveRequest, lostReason?: string | null) =>
    move.mutate({ deal: req.deal, move: { stageId: req.stage.id, beforeDealId: req.beforeDealId ?? null, afterDealId: req.afterDealId ?? null, lostReason: lostReason ?? null, expectedVersion: req.deal.version } });
  const onBoardMove = (req: BoardMoveRequest) => {
    if (req.stage.type === 'lost' && req.deal.stageId !== req.stage.id) setLostAsk(req);
    else doMove(req);
  };

  const columns = useMemo<CrmColumn<DealListItem>[]>(
    () => [
      { id: 'title', label: 'Deal', hideable: false, sortKey: 'title', cell: (d) => d.title },
      { id: 'account', label: 'Account', cell: (d) => (d.account ? <Link className="focus-ring rounded-sm hover:underline" href={`/app/accounts/${d.account.id}`}>{d.account.name}</Link> : '') },
      { id: 'contact', label: 'Contact', cell: (d) => (d.contact ? <Link className="focus-ring rounded-sm hover:underline" href={`/app/contacts/${d.contact.id}`}>{d.contact.name}</Link> : '') },
      {
        id: 'stage',
        label: 'Stage',
        cell: (d) => {
          const s = stages.find((x) => x.id === d.stageId);
          return s ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn('size-2 rounded-full', STAGE_DOT[stageTone(s)])} />
              {s.name}
            </span>
          ) : (
            ''
          );
        },
      },
      { id: 'value', label: 'Value', align: 'right', sortKey: 'valueInr', firstDir: 'desc', cell: (d) => formatInr(d.valueInr) },
      { id: 'probability', label: 'Probability', align: 'right', cell: (d) => `${d.probability}%` },
      { id: 'weighted', label: 'Weighted', align: 'right', defaultHidden: true, cell: (d) => formatInr(d.weightedValueInr) },
      { id: 'owner', label: 'Owner', cell: (d) => d.owner?.name ?? <span className="text-muted">Unassigned</span> },
      { id: 'close', label: 'Expected close', sortKey: 'expectedCloseAt', firstDir: 'asc', cell: (d) => formatDateIn(d.expectedCloseAt, tz) },
      { id: 'status', label: 'Status', cell: (d) => <Chip tone={DEAL_STATUS[d.status].tone}>{DEAL_STATUS[d.status].label}</Chip> },
      { id: 'products', label: 'Products', align: 'right', defaultHidden: true, cell: (d) => d.lineCount || '' },
      { id: 'updated', label: 'Updated', sortKey: 'updatedAt', firstDir: 'desc', cell: (d) => ago(d.updatedAt, now) },
    ],
    [stages, tz, now],
  );
  const prefs = useColumnPrefs('deals', columns);
  const tableStatus = table.isPending ? 'loading' : table.isError ? 'error' : rows.length === 0 ? 'empty' : 'ready';
  const totals = board.data?.columns.reduce((acc, c) => ({ count: acc.count + c.count, value: acc.value + c.totalValueInr, weighted: acc.weighted + c.weightedValueInr }), { count: 0, value: 0, weighted: 0 });

  return (
    <div className="flex w-full min-w-0 flex-col pb-20">
      <PageHeader
        title="Deals"
        description="Opportunities by stage, with value, probability and expected close."
        meta={mode === 'board' && totals ? <Chip tone="indigo">{`${totals.count} · ${formatInr(totals.value, { compact: true })} · weighted ${formatInr(totals.weighted, { compact: true })}`}</Chip> : undefined}
        actions={
          canCreate && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              New deal
            </Button>
          )
        }
      />
      <ListToolbar>
        <Segmented
          label="View"
          value={mode}
          onChange={(m) => {
            setMode(m);
            list.clearSelection();
          }}
          options={[
            { value: 'board', label: 'Board' },
            { value: 'table', label: 'Table' },
          ]}
        />
        <span className="sr-only" aria-live="polite">
          {mode === 'board' ? 'Board view' : 'Table view'}
        </span>
        <CrmSearch className="w-full sm:w-64" value={list.q} onChange={list.setQ} placeholder="Search title, account, contact" label="Search deals" />
        <OwnerFilter value={list.filters.ownerId} onChange={(ownerId) => list.setFilters({ ownerId })} />
        <FacetFilter label="Status" options={STATUS_OPTIONS} value={list.filters.status} onChange={(status) => list.setFilters({ status: status as StageType[] | undefined })} />
        {mode === 'table' && stages.length > 0 && <FacetFilter label="Stage" icon={<Columns3 aria-hidden />} options={stages.map((s) => ({ value: s.id, label: s.name }))} value={list.filters.stageId} onChange={(stageId) => list.setFilters({ stageId })} />}
        {pipelineList.length > 1 && (
          <NativeSelect aria-label="Pipeline" wrapperClassName="w-44" value={pipeline?.id ?? ''} onChange={(e) => list.setFilters({ pipelineId: e.target.value, stageId: undefined })}>
            {pipelineList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        )}
        <ClearFilters active={list.hasFilters} onClear={list.resetFilters} />
        {mode === 'table' && (
          <div className="ml-auto">
            <ColumnSetsMenu {...prefs.menu} />
          </div>
        )}
      </ListToolbar>
      {mode === 'board' ? (
        board.isError ? (
          <EmptyState icon={<AlertCircle />} title="The deals board did not load" description="Check your connection, then try again." action={<Button onClick={() => void board.refetch()}>Try again</Button>} />
        ) : board.data && board.data.columns.every((c) => c.count === 0) && !list.hasFilters ? (
          <EmptyDeals canCreate={canCreate} onCreate={() => setCreating(true)} />
        ) : (
          <DealsBoard board={board.data} loading={board.isPending} canMove={canUpdate} onMove={onBoardMove} timeZone={tz} />
        )
      ) : (
        <CrmTable
          label="Deals"
          rows={rows}
          getId={(d) => d.id}
          columns={columns}
          visible={prefs.visible}
          status={tableStatus}
          onRetry={() => void table.refetch()}
          sort={list.sort}
          onSortChange={list.setSort}
          rowHref={(d) => `/app/deals/${d.id}`}
          selection={canUpdate || canDelete ? { selected: list.selected, onChange: list.setSelected } : undefined}
          hasMore={table.hasNextPage}
          loadingMore={table.isFetchingNextPage}
          onLoadMore={() => void table.fetchNextPage()}
          mobileCard={(d) => (
            <Link href={`/app/deals/${d.id}`} className="focus-ring block rounded-sm">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-fg">{d.title}</span>
                <span className="text-sm font-semibold tabular-nums">{formatInr(d.valueInr, { compact: true })}</span>
              </span>
              <span className="block truncate text-xs text-muted-strong">{[d.account?.name, stages.find((s) => s.id === d.stageId)?.name, d.owner?.name].filter(Boolean).join(' · ')}</span>
            </Link>
          )}
          empty={
            list.hasFilters
              ? { icon: <Handshake />, title: 'No deals match these filters', description: 'Clear the filters or search for another name.', action: <Button onClick={list.resetFilters}>Clear filters</Button> }
              : { icon: <Handshake />, title: 'No deals yet', description: 'Create a deal, or convert a qualified lead into a deal.', action: canCreate && <Button variant="primary" onClick={() => setCreating(true)}>New deal</Button> }
          }
        />
      )}
      {mode === 'table' && <DealsBulkBar selected={list.selected} onClear={list.clearSelection} stages={stages} canUpdate={canUpdate} canDelete={canDelete} />}
      {creating && <DealFormSheet open onOpenChange={setCreating} />}
      {lostAsk && (
        <LostReasonDialog
          dealTitle={lostAsk.deal.title}
          stageName={lostAsk.stage.name}
          onCancel={() => setLostAsk(null)}
          onConfirm={(reason) => {
            doMove(lostAsk, reason);
            setLostAsk(null);
          }}
        />
      )}
    </div>
  );
}

function EmptyDeals({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
  return (
    <div data-slot="empty-state" className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface px-6 py-14 text-center">
      <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-surface-3 text-fg-secondary">
        <Handshake className="size-5" />
      </span>
      <h2 className="text-base font-semibold text-fg">No deals yet</h2>
      <p className="max-w-md text-sm text-muted">Create a deal for an account, or open a qualified lead and convert it. Deals move across the stages here.</p>
      {canCreate && (
        <Button variant="primary" onClick={onCreate}>
          <Plus aria-hidden />
          New deal
        </Button>
      )}
    </div>
  );
}

function LostReasonDialog({ dealTitle, stageName, onCancel, onConfirm }: { dealTitle: string; stageName: string; onCancel: () => void; onConfirm: (reason: string | null) => void }) {
  const [reason, setReason] = useState('');
  return (
    <ConfirmDialog open onOpenChange={(o) => !o && onCancel()} title={`Move ${dealTitle} to ${stageName}?`} description="Say why the deal was lost. Reports group lost deals by this reason." confirmLabel="Mark as lost" tone="primary" onConfirm={() => onConfirm(reason.trim() || null)}>
      <FormField label="Lost reason" hint="Optional">
        <Input autoFocus value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Price too high, went with a competitor" />
      </FormField>
    </ConfirmDialog>
  );
}

function DealsBulkBar({ selected, onClear, stages, canUpdate, canDelete }: { selected: ReadonlySet<string>; onClear: () => void; stages: readonly Stage[]; canUpdate: boolean; canDelete: boolean }) {
  const m = useDealMutations();
  const users = useScopedUserList();
  const canAssign = useCan('leads.assign');
  const [confirm, setConfirm] = useState(false);
  const ids = [...selected];
  const word = (n: number) => (n === 1 ? 'deal' : 'deals');
  const run = async (action: Parameters<typeof m.bulk.mutateAsync>[0], done: (n: number) => string) => {
    try {
      reportBulkResult(await m.bulk.mutateAsync(action), done);
      onClear();
    } catch (e) {
      reportBulkResult({ succeeded: 0, failed: [{ message: e instanceof Error ? e.message : 'Try again.' }] }, done);
    }
  };
  return (
    <>
      <BulkBar count={selected.size} onClear={onClear}>
        {canUpdate && canAssign && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                <UserRound aria-hidden />
                Assign
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" className="w-56">
              <DropdownMenuLabel>Assign to</DropdownMenuLabel>
              {users.map((u) => (
                <DropdownMenuItem key={u.id} onSelect={() => void run({ action: 'assign', ids, ownerId: u.id }, (n) => `${n} ${word(n)} assigned to ${u.name}.`)}>
                  {u.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {canUpdate && stages.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                <Columns3 aria-hidden />
                Stage
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" className="w-52">
              <DropdownMenuLabel>Move to stage</DropdownMenuLabel>
              {stages.map((s) => (
                <DropdownMenuItem key={s.id} onSelect={() => void run({ action: 'change_stage', ids, stageId: s.id }, (n) => `${n} ${word(n)} moved to ${s.name}.`)}>
                  {s.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {canDelete && (
          <Button size="sm" variant="ghost" className="text-danger-text" onClick={() => setConfirm(true)}>
            <Trash2 aria-hidden />
            Delete
          </Button>
        )}
      </BulkBar>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${selected.size} ${word(selected.size)}?`}
        description="Quotations and invoices stay; their link to the deal is removed. This cannot be undone."
        confirmLabel="Delete"
        loading={m.bulk.isPending}
        onConfirm={() => void run({ action: 'delete', ids }, (n) => `${n} ${word(n)} deleted.`).then(() => setConfirm(false))}
      />
    </>
  );
}

