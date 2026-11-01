'use client';

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type VisibilityState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { formatInr, type LeadListItem } from '@vistar/shared';
import { AlarmClock, ArrowDown, ArrowUp, ArrowUpDown, Columns3Cog, Loader2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { LeadQuickActions, useLeadActions } from '@/components/leads-shared/lead-actions';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { useLeadsViewState } from '@/lib/leads/state';
import { useCan } from '@/lib/session/session';
import { LeadCardList } from './lead-card-list';
import {
  formatCreated,
  formatFollowUp,
  formatPhone,
  isOverdue,
  SourceChip,
  TagList,
  TemperatureChip,
} from './lead-meta';
import { Checkbox } from './primitives/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './primitives/menu';
import { StageSelect } from './stage-select';
import { useLeadWords } from './use-lead-words';
import { EmptyState, ErrorState, NoLeadsYet } from './states';
import { useRecentLeads, useTablePrefs, type LeadSortField } from './stores';
import { useFillViewport } from './use-fill-viewport';
import { useIsTableLayout } from './use-media-query';
import { useTableRows } from './use-table-rows';

const ROW_HEIGHT = 40;

/** Table view: virtualised dense table from 768px, card list below. */
export function TableView({ onCreate }: { onCreate?: () => void }) {
  const isTable = useIsTableLayout();
  return isTable ? <LeadsTable onCreate={onCreate} /> : <LeadCardList onCreate={onCreate} />;
}

interface ColumnInfo {
  label: string;
  sortField?: LeadSortField;
  /** First click direction for sortable columns. */
  firstDir?: 'asc' | 'desc';
  align?: 'right';
  hideable?: boolean;
  /** Cell classes (e.g. sticky). */
  cellClass?: string;
}

const COLUMN_INFO: Record<string, ColumnInfo> = {
  select: { label: 'Select' },
  lead: { label: 'Lead', sortField: 'name', firstDir: 'asc' },
  phone: { label: 'Phone', hideable: true },
  source: { label: 'Source', hideable: true },
  stage: { label: 'Stage', hideable: true },
  owner: { label: 'Owner', hideable: true },
  value: {
    label: 'Value',
    sortField: 'valueInr',
    firstDir: 'desc',
    align: 'right',
    hideable: true,
  },
  score: { label: 'Score', sortField: 'score', firstDir: 'desc', align: 'right', hideable: true },
  temperature: { label: 'Temperature', hideable: true },
  tags: { label: 'Tags', hideable: true },
  followUp: {
    label: 'Next follow-up',
    sortField: 'nextFollowUpAt',
    firstDir: 'asc',
    hideable: true,
  },
  created: { label: 'Created', sortField: 'createdAt', firstDir: 'desc', hideable: true },
  actions: { label: 'Quick actions', cellClass: 'sticky right-0 z-[1] border-l' },
};

/** Select + Lead columns stay pinned while the table scrolls sideways. */
function stickyLeft(id: string, canBulk: boolean): string {
  if (id === 'select') return 'sticky left-0';
  if (id === 'lead') return canBulk ? 'sticky left-10' : 'sticky left-0';
  return '';
}

interface RowCtx {
  activeIndex: number;
  selected: ReadonlySet<string>;
  onCheck: (index: number, shift: boolean) => void;
}

function buildColumns(canBulk: boolean): ColumnDef<LeadListItem>[] {
  const cols: ColumnDef<LeadListItem>[] = [
    {
      id: 'lead',
      size: 220,
      header: 'Lead',
      cell: ({ row }) => (
        <div className="flex min-w-0 flex-col leading-4">
          <span className="truncate font-medium text-fg">{row.original.name}</span>
          <span className="truncate text-2xs text-muted group-data-[state=selected]/row:text-muted-strong">
            {row.original.companyName ?? 'No company'}
          </span>
        </div>
      ),
    },
    {
      id: 'phone',
      size: 132,
      header: 'Phone',
      cell: ({ row }) => (
        <span className="tabular text-fg-secondary">{formatPhone(row.original.phone)}</span>
      ),
    },
    {
      id: 'source',
      size: 112,
      header: 'Source',
      cell: ({ row }) => <SourceChip source={row.original.source} />,
    },
    {
      id: 'stage',
      size: 132,
      header: 'Stage',
      cell: ({ row, table }) => {
        const ctx = table.options.meta as RowCtx;
        return (
          <StageSelect lead={row.original} tabIndex={row.index === ctx.activeIndex ? 0 : -1} />
        );
      },
    },
    {
      id: 'owner',
      size: 150,
      header: 'Owner',
      cell: ({ row }) =>
        row.original.owner ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={row.original.owner.name} size="xs" aria-hidden />
            <span className="truncate text-fg-secondary">{row.original.owner.name}</span>
          </span>
        ) : (
          <span className="text-muted group-data-[state=selected]/row:text-muted-strong">
            Unassigned
          </span>
        ),
    },
    {
      id: 'value',
      size: 104,
      header: 'Value',
      cell: ({ row }) => <span className="tabular">{formatInr(row.original.valueInr)}</span>,
    },
    {
      id: 'score',
      size: 64,
      header: 'Score',
      cell: ({ row }) => <span className="tabular">{row.original.score}</span>,
    },
    {
      id: 'temperature',
      size: 104,
      header: 'Temperature',
      cell: ({ row }) => <TemperatureChip temperature={row.original.temperature} />,
    },
    {
      id: 'tags',
      size: 150,
      header: 'Tags',
      cell: ({ row }) => <TagList tags={row.original.tags} />,
    },
    {
      id: 'followUp',
      size: 136,
      header: 'Next follow-up',
      cell: ({ row }) => {
        const at = row.original.nextFollowUpAt;
        if (!at)
          return (
            <span className="text-muted group-data-[state=selected]/row:text-muted-strong">—</span>
          );
        const overdue = isOverdue(at);
        return (
          <span
            className={cn(
              'inline-flex items-center gap-1',
              overdue ? 'font-medium text-danger-text' : 'text-fg-secondary',
            )}
          >
            {overdue && <AlarmClock aria-hidden className="size-3.5" />}
            {overdue && <span className="sr-only">Overdue: </span>}
            {formatFollowUp(at)}
          </span>
        );
      },
    },
    {
      id: 'created',
      size: 104,
      header: 'Created',
      cell: ({ row }) => (
        <span className="tabular text-fg-secondary">{formatCreated(row.original.createdAt)}</span>
      ),
    },
    {
      id: 'actions',
      size: 104,
      header: '',
      cell: ({ row }) => (
        <LeadQuickActions
          lead={row.original}
          className="invisible justify-end group-hover/row:visible group-focus-within/row:visible pointer-coarse:visible"
        />
      ),
    },
  ];
  if (canBulk) {
    cols.unshift({
      id: 'select',
      size: 40,
      header: '',
      cell: ({ row, table }) => {
        const ctx = table.options.meta as RowCtx;
        return (
          <Checkbox
            checked={ctx.selected.has(row.original.id)}
            tabIndex={row.index === ctx.activeIndex ? 0 : -1}
            aria-label={`Select ${row.original.name}`}
            onClick={(e) => {
              e.stopPropagation();
              ctx.onCheck(row.index, e.shiftKey);
            }}
          />
        );
      },
    });
  }
  return cols;
}

function LeadsTable({ onCreate }: { onCreate?: () => void }) {
  const canBulk = useCan('leads.bulk');
  const canCreate = useCan('leads.create');
  const w = useLeadWords();
  const actions = useLeadActions();
  const { query, rows, total, hasFilters } = useTableRows();
  const resetFilters = useLeadsViewState((s) => s.resetFilters);
  const selectedIds = useLeadsViewState((s) => s.selectedIds);
  const toggleSelected = useLeadsViewState((s) => s.toggleSelected);
  const setSelected = useLeadsViewState((s) => s.setSelected);
  const clearSelection = useLeadsViewState((s) => s.clearSelection);
  const setTableScroll = useLeadsViewState((s) => s.setTableScroll);
  const recent = useRecentLeads((s) => s.ids);
  const sort = useTablePrefs((s) => s.sort);
  const setSort = useTablePrefs((s) => s.setSort);
  const columnPrefs = useTablePrefs((s) => s.columns);
  const setColumnVisible = useTablePrefs((s) => s.setColumnVisible);
  const resetColumns = useTablePrefs((s) => s.resetColumns);

  const scrollRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);
  const lastTop = useRef(0);
  const restored = useRef(false);
  const [activeIndex, setActiveIndex] = useState(0);
  useFillViewport(scrollRef);

  const columns = useMemo(() => buildColumns(canBulk), [canBulk]);
  const columnVisibility: VisibilityState = columnPrefs;

  const onCheck = useCallback(
    (index: number, shift: boolean) => {
      const lead = rows[index];
      if (!lead) return;
      if (shift && anchor.current !== null) {
        const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
        const next = new Set(selectedIds);
        const select = !selectedIds.has(lead.id);
        rows.slice(a, b + 1).forEach((r) => (select ? next.add(r.id) : next.delete(r.id)));
        setSelected(next);
      } else {
        toggleSelected(lead.id);
      }
      anchor.current = index;
    },
    [rows, selectedIds, setSelected, toggleSelected],
  );

  const meta: RowCtx = { activeIndex, selected: selectedIds, onCheck };
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns non-memoisable functions; rows re-render on state change by design.
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.id,
    manualSorting: true,
    state: { columnVisibility },
    meta,
  });
  const visibleColumns = table.getVisibleLeafColumns();
  const tableRows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    initialOffset: () => useLeadsViewState.getState().scroll.table.top,
  });
  const items = virtualizer.getVirtualItems();
  const paddingTop = items[0]?.start ?? 0;
  const paddingBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);

  // Restore the Table scroll position after a view switch (cache already holds the pages).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || restored.current || rows.length === 0) return;
    restored.current = true;
    const top = useLeadsViewState.getState().scroll.table.top;
    if (top > 0) el.scrollTop = top;
  }, [rows.length]);

  // Remember the position for the next switch back to Table.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      lastTop.current = el.scrollTop;
      clearTimeout(t);
      t = setTimeout(() => setTableScroll(lastTop.current), 150);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(t);
      el.removeEventListener('scroll', onScroll);
      if (restored.current) setTableScroll(lastTop.current);
    };
  }, [setTableScroll]);

  // Infinite loading: fetch the next page when the last rendered row nears the end.
  const lastIndex = items.at(-1)?.index ?? -1;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && lastIndex >= tableRows.length - 15)
      void fetchNextPage();
  }, [lastIndex, tableRows.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const focusRow = (index: number) => {
    const i = Math.max(0, Math.min(tableRows.length - 1, index));
    setActiveIndex(i);
    virtualizer.scrollToIndex(i, { align: 'auto' });
    const focus = () =>
      scrollRef.current
        ?.querySelector<HTMLElement>(`tr[data-index="${i}"]`)
        ?.focus({ preventScroll: true });
    requestAnimationFrame(() => requestAnimationFrame(focus));
  };

  const onRowKeyDown = (
    e: KeyboardEvent<HTMLTableRowElement>,
    index: number,
    lead: LeadListItem,
  ) => {
    if (e.target !== e.currentTarget) return;
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / ROW_HEIGHT) - 1);
    const keys: Record<string, () => void> = {
      Enter: () => actions.open(lead),
      ArrowDown: () => focusRow(index + 1),
      ArrowUp: () => focusRow(index - 1),
      PageDown: () => focusRow(index + page),
      PageUp: () => focusRow(index - page),
      Home: () => focusRow(0),
      End: () => focusRow(tableRows.length - 1),
      ...(canBulk ? { ' ': () => onCheck(index, e.shiftKey) } : {}),
    };
    const fn = keys[e.key];
    if (!fn) return;
    e.preventDefault();
    fn();
  };

  const toggleSort = (field: LeadSortField, firstDir: 'asc' | 'desc') => {
    if (sort.sort === field) setSort({ sort: field, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    else setSort({ sort: field, dir: firstDir });
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const allLoadedSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const someSelected = rows.some((r) => selectedIds.has(r.id));
  const loading = query.isPending;
  const showError = query.isError && rows.length === 0;
  const showEmpty = !loading && !query.isError && rows.length === 0;
  const colCount = visibleColumns.length;
  const hideable = table.getAllLeafColumns().filter((c) => COLUMN_INFO[c.id]?.hideable);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      <div
        ref={scrollRef}
        className="relative min-h-80 overflow-auto overscroll-contain [overflow-anchor:none]"
        aria-busy={query.isFetching && !isFetchingNextPage ? true : undefined}
      >
        <table
          className="border-separate border-spacing-0 text-sm"
          style={{ tableLayout: 'fixed', width: table.getTotalSize(), minWidth: '100%' }}
          aria-label={w.Leads}
          aria-rowcount={total + 1}
        >
          <colgroup>
            {visibleColumns.map((c) => (
              <col key={c.id} style={{ width: c.getSize() }} />
            ))}
          </colgroup>
          <TableHeader>
            <tr aria-rowindex={1}>
              {visibleColumns.map((c) => {
                const info = COLUMN_INFO[c.id] ?? { label: c.id };
                const sorted = info.sortField && sort.sort === info.sortField ? sort.dir : null;
                return (
                  <TableHead
                    key={c.id}
                    aria-sort={
                      info.sortField
                        ? sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : 'none'
                        : undefined
                    }
                    className={cn(
                      info.align === 'right' && 'text-right',
                      c.id === 'actions' && 'sticky right-0 z-[2] border-l text-right',
                      c.id === 'select' && 'pr-0',
                      stickyLeft(c.id, canBulk) && cn(stickyLeft(c.id, canBulk), 'z-[2]'),
                    )}
                  >
                    {c.id === 'select' ? (
                      <Checkbox
                        checked={allLoadedSelected ? true : someSelected ? 'indeterminate' : false}
                        aria-label={
                          allLoadedSelected
                            ? 'Clear selection'
                            : `Select all ${rows.length} loaded ${w.leads}`
                        }
                        disabled={rows.length === 0}
                        onClick={() =>
                          allLoadedSelected
                            ? clearSelection()
                            : setSelected(new Set([...selectedIds, ...rows.map((r) => r.id)]))
                        }
                      />
                    ) : c.id === 'actions' ? (
                      <ColumnChooser
                        columns={hideable.map((col) => ({
                          id: col.id,
                          label: COLUMN_INFO[col.id]!.label,
                          visible: col.getIsVisible(),
                        }))}
                        onToggle={setColumnVisible}
                        onReset={resetColumns}
                      />
                    ) : info.sortField ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(info.sortField!, info.firstDir ?? 'desc')}
                        className={cn(
                          'focus-ring -mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:text-fg',
                          info.align === 'right' && 'flex-row-reverse',
                          sorted && 'text-fg',
                        )}
                      >
                        {info.label}
                        {sorted === 'asc' ? (
                          <ArrowUp aria-hidden className="size-3.5" />
                        ) : sorted === 'desc' ? (
                          <ArrowDown aria-hidden className="size-3.5" />
                        ) : (
                          <ArrowUpDown aria-hidden className="size-3.5 opacity-50" />
                        )}
                      </button>
                    ) : (
                      info.label
                    )}
                  </TableHead>
                );
              })}
            </tr>
          </TableHeader>
          <tbody
            className={cn(
              'transition-opacity duration-150',
              query.isPlaceholderData && 'opacity-60',
            )}
          >
            {loading &&
              Array.from({ length: 12 }, (_, i) => (
                <tr key={`sk-${i}`} aria-hidden>
                  {visibleColumns.map((c) => (
                    <td key={c.id} className="h-10 border-b border-border px-3">
                      <Skeleton
                        className={cn(
                          'h-3.5',
                          c.id === 'lead' ? 'w-36' : c.id === 'select' ? 'size-4' : 'w-16',
                          COLUMN_INFO[c.id]?.align === 'right' && 'ml-auto',
                        )}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            {showError && (
              <tr>
                <td colSpan={colCount}>
                  <ErrorState onRetry={() => void query.refetch()} retrying={query.isRefetching} />
                </td>
              </tr>
            )}
            {showEmpty && (
              <tr>
                <td colSpan={colCount}>
                  {hasFilters ? (
                    <EmptyState
                      title={`No ${w.leads} match these filters`}
                      description="Try a wider date range or fewer filters."
                      action={<Button onClick={resetFilters}>Clear filters</Button>}
                    />
                  ) : (
                    <NoLeadsYet
                      action={
                        canCreate && onCreate ? (
                          <Button onClick={onCreate}>New {w.lead}</Button>
                        ) : undefined
                      }
                    />
                  )}
                </td>
              </tr>
            )}
            {paddingTop > 0 && (
              <tr aria-hidden>
                <td colSpan={colCount} style={{ height: paddingTop, padding: 0, border: 0 }} />
              </tr>
            )}
            {items.map((vi) => {
              const row = tableRows[vi.index];
              if (!row) return null;
              const lead = row.original;
              const selected = selectedIds.has(lead.id);
              return (
                <TableRow
                  key={row.id}
                  data-index={vi.index}
                  aria-rowindex={vi.index + 2}
                  data-state={selected ? 'selected' : undefined}
                  data-new={recent.has(lead.id) ? 'true' : undefined}
                  tabIndex={vi.index === activeIndex ? 0 : -1}
                  onFocus={(e) => e.target === e.currentTarget && setActiveIndex(vi.index)}
                  onClick={(e) =>
                    e.shiftKey && canBulk ? onCheck(vi.index, true) : actions.open(lead)
                  }
                  onKeyDown={(e) => onRowKeyDown(e, vi.index, lead)}
                  className="cursor-pointer focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  {row.getVisibleCells().map((cell) => {
                    const info = COLUMN_INFO[cell.column.id];
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          'h-10 overflow-hidden',
                          info?.align === 'right' && 'text-right',
                          cell.column.id === 'select' && 'pr-0',
                          info?.cellClass,
                          stickyLeft(cell.column.id, canBulk) &&
                            cn(stickyLeft(cell.column.id, canBulk), 'z-[1] bg-inherit'),
                          cell.column.id === 'actions' && 'bg-inherit py-0 pr-2 pl-0',
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
            {paddingBottom > 0 && (
              <tr aria-hidden>
                <td colSpan={colCount} style={{ height: paddingBottom, padding: 0, border: 0 }} />
              </tr>
            )}
            {rows.length > 0 && (
              <tr>
                <td colSpan={colCount} className="h-10 px-3 text-xs text-muted">
                  {isFetchingNextPage ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 aria-hidden className="size-3.5 animate-spin" />
                      Loading more leads…
                    </span>
                  ) : query.isFetchNextPageError ? (
                    <span className="inline-flex items-center gap-2 text-danger-text">
                      More leads did not load.
                      <Button size="sm" variant="link" onClick={() => void fetchNextPage()}>
                        Try again
                      </Button>
                    </span>
                  ) : hasNextPage ? (
                    `Showing ${rows.length} of ${total}`
                  ) : (
                    `All ${total} ${w.leads} loaded`
                  )}
                </td>
              </tr>
            )}
            {selectedIds.size > 0 && (
              <tr aria-hidden>
                <td colSpan={colCount} style={{ height: 64, padding: 0, border: 0 }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ColumnChooser({
  columns,
  onToggle,
  onReset,
}: {
  columns: Array<{ id: string; label: string; visible: boolean }>;
  onToggle: (id: string, visible: boolean) => void;
  onReset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="Choose columns" className="ml-auto">
          <Columns3Cog aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Columns</DropdownMenuLabel>
        {columns.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.id}
            checked={c.visible}
            onCheckedChange={(v) => onToggle(c.id, v === true)}
            onSelect={(e) => e.preventDefault()}
          >
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onReset}>Show all columns</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
