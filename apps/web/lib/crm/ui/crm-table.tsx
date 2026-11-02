'use client';

import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { useMediaQuery } from '@/components/common/use-media-query';
import { Checkbox } from '@/components/leads/primitives/checkbox';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';

export type SortDir = 'asc' | 'desc';
export interface ListSort {
  key: string;
  dir: SortDir;
}

export interface CrmColumn<T> {
  id: string;
  label: string;
  cell: (row: T) => ReactNode;
  /** Sort field sent to the API; omit = not sortable. */
  sortKey?: string;
  /** First direction when this column is clicked (numbers and dates: desc). */
  firstDir?: SortDir;
  align?: 'left' | 'right';
  /** false = always shown (the name column). Default true. */
  hideable?: boolean;
  /** Hidden until the person turns it on in the column chooser. */
  defaultHidden?: boolean;
  className?: string;
}

export type ListStatus = 'loading' | 'error' | 'empty' | 'ready';

export interface CrmTableProps<T> {
  /** Accessible table name ("Contacts"). */
  label: string;
  rows: readonly T[];
  getId: (row: T) => string;
  columns: readonly CrmColumn<T>[];
  /** Visible column ids (from useColumnPrefs). */
  visible: readonly string[];
  status: ListStatus;
  onRetry?: () => void;
  empty: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode };
  /** Row selection for bulk actions; omit to hide the checkboxes. */
  selection?: { selected: ReadonlySet<string>; onChange: (next: Set<string>) => void };
  sort?: ListSort;
  onSortChange?: (sort: ListSort) => void;
  /** Detail page of a row; the first visible column links there. */
  rowHref?: (row: T) => string;
  /** Hover actions at the end of the row (icon buttons with aria-labels). */
  rowActions?: (row: T) => ReactNode;
  /** Card shown instead of the table below 640px. */
  mobileCard: (row: T) => ReactNode;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** Ids to highlight as new (slide-in). */
  newIds?: ReadonlySet<string>;
  toolbar?: ReactNode;
  className?: string;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown aria-hidden className="size-3.5 text-muted opacity-0 transition-opacity group-hover/th:opacity-100" />;
  return dir === 'asc' ? <ArrowUp aria-hidden className="size-3.5" /> : <ArrowDown aria-hidden className="size-3.5" />;
}

/**
 * Dense CRM list: sticky header, sortable columns, row selection, column visibility, hover actions,
 * "Load more" for cursor pages, and card rows on phones. Loading, empty and error states built in.
 */
export function CrmTable<T>(props: CrmTableProps<T>) {
  const { label, rows, getId, columns, visible, status, onRetry, empty, selection, sort, onSortChange, rowHref, rowActions, mobileCard } = props;
  const wide = useMediaQuery('(min-width: 640px)');
  const shown = useMemo(() => columns.filter((c) => visible.includes(c.id)), [columns, visible]);
  const ids = useMemo(() => rows.map(getId), [rows, getId]);
  const selectedCount = selection ? ids.filter((id) => selection.selected.has(id)).length : 0;
  const allChecked: boolean | 'indeterminate' = selectedCount === 0 ? false : selectedCount === ids.length ? true : 'indeterminate';
  const colCount = shown.length + (selection ? 1 : 0) + (rowActions ? 1 : 0);

  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (allChecked === true) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    selection.onChange(next);
  };
  const toggle = (id: string, on: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (on) next.add(id);
    else next.delete(id);
    selection.onChange(next);
  };
  const clickSort = (c: CrmColumn<T>) => {
    if (!c.sortKey || !onSortChange) return;
    if (sort?.key === c.sortKey) onSortChange({ key: c.sortKey, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    else onSortChange({ key: c.sortKey, dir: c.firstDir ?? 'asc' });
  };

  const stateBlock =
    status === 'error' ? (
      <EmptyState
        size="sm"
        className="border-none"
        icon={<AlertCircle />}
        title={`${label} did not load`}
        description="Check your connection, then try again."
        action={
          onRetry && (
            <Button onClick={onRetry}>
              <RotateCw aria-hidden />
              Try again
            </Button>
          )
        }
      />
    ) : status === 'empty' ? (
      <EmptyState size="sm" className="border-none" icon={empty.icon} title={empty.title} description={empty.description} action={empty.action} />
    ) : null;

  const footer = props.hasMore && status === 'ready' && (
    <div className="flex justify-center border-t border-border p-2">
      <Button size="sm" variant="ghost" loading={props.loadingMore} onClick={props.onLoadMore}>
        Load more
      </Button>
    </div>
  );

  if (!wide) {
    return (
      <Card className={cn('overflow-hidden', props.className)}>
        {props.toolbar && <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">{props.toolbar}</div>}
        {status === 'loading' && (
          <ul aria-label={label} aria-busy="true" className="divide-y divide-border">
            {Array.from({ length: 5 }, (_, i) => (
              <li key={i} className="flex flex-col gap-2 px-3 py-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </li>
            ))}
          </ul>
        )}
        {stateBlock && <div className="p-3">{stateBlock}</div>}
        {status === 'ready' && (
          <ul aria-label={label} className="divide-y divide-border">
            {rows.map((r) => {
              const id = getId(r);
              return (
                <li key={id} data-new={props.newIds?.has(id) || undefined} className="flex items-start gap-3 px-3 py-3 data-[new=true]:animate-row-in">
                  {selection && (
                    <Checkbox
                      className="mt-0.5"
                      checked={selection.selected.has(id)}
                      onCheckedChange={(v) => toggle(id, v === true)}
                      aria-label="Select row"
                    />
                  )}
                  <div className="min-w-0 flex-1">{mobileCard(r)}</div>
                </li>
              );
            })}
          </ul>
        )}
        {footer}
      </Card>
    );
  }

  return (
    <Card className={cn('overflow-hidden', props.className)}>
      {props.toolbar && <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">{props.toolbar}</div>}
      <Table aria-label={label} aria-busy={status === 'loading' || undefined} aria-rowcount={status === 'ready' ? rows.length + 1 : undefined}>
        <TableHeader>
          <TableRow className="hover:bg-surface">
            {selection && (
              <TableHead className="w-8">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={toggleAll}
                  disabled={status !== 'ready' || rows.length === 0}
                  aria-label={allChecked === true ? 'Clear selection on this page' : 'Select all rows on this page'}
                />
              </TableHead>
            )}
            {shown.map((c) => {
              const active = !!c.sortKey && sort?.key === c.sortKey;
              return (
                <TableHead
                  key={c.id}
                  className={cn('group/th', c.align === 'right' && 'text-right', c.className)}
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.sortKey && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => clickSort(c)}
                      className={cn('focus-ring -mx-1 inline-flex items-center gap-1 rounded-sm px-1 hover:text-fg', c.align === 'right' && 'flex-row-reverse', active && 'text-fg')}
                    >
                      {c.label}
                      <SortIcon active={active} dir={sort?.dir ?? 'asc'} />
                    </button>
                  ) : (
                    c.label
                  )}
                </TableHead>
              );
            })}
            {rowActions && (
              <TableHead className="w-24">
                <span className="sr-only">Actions</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {status === 'loading' &&
            Array.from({ length: 8 }, (_, r) => (
              <TableRow key={r} className="hover:bg-surface">
                {Array.from({ length: colCount }, (_, i) => (
                  <TableCell key={i}>
                    <Skeleton className={cn('h-3.5', i === (selection ? 1 : 0) ? 'w-36' : 'w-16')} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          {stateBlock && (
            <TableRow className="hover:bg-surface">
              <TableCell colSpan={colCount} className="h-auto p-3 whitespace-normal">
                {stateBlock}
              </TableCell>
            </TableRow>
          )}
          {status === 'ready' &&
            rows.map((r) => {
              const id = getId(r);
              const checked = !!selection?.selected.has(id);
              return (
                <TableRow key={id} data-state={checked ? 'selected' : undefined} data-new={props.newIds?.has(id) || undefined}>
                  {selection && (
                    <TableCell className="w-8">
                      <Checkbox checked={checked} onCheckedChange={(v) => toggle(id, v === true)} aria-label="Select row" />
                    </TableCell>
                  )}
                  {shown.map((c, i) => (
                    <TableCell key={c.id} className={cn(c.align === 'right' && 'text-right tabular-nums', c.className)}>
                      {i === 0 && rowHref ? (
                        <Link href={rowHref(r)} className="focus-ring rounded-sm font-medium text-fg hover:underline">
                          {c.cell(r)}
                        </Link>
                      ) : (
                        c.cell(r)
                      )}
                    </TableCell>
                  ))}
                  {rowActions && (
                    <TableCell className="w-24 text-right">
                      <div className="flex justify-end gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/row:opacity-100 sm:group-focus-within/row:opacity-100">
                        {rowActions(r)}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
        </TableBody>
      </Table>
      {footer}
    </Card>
  );
}
