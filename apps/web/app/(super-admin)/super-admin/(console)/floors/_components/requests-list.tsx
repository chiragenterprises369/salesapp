'use client';

import { FLOOR_REQUEST_STATUSES, type FloorRequestStatus } from '@vistar/shared';
import { Building, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/native-select';
import { PageHeader } from '@/components/common/page-header';
import { formatDateTimeIn } from '@/components/common/time';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { useSuperCompanies, useSuperFloorRequests } from './data';
import { REQUEST_STATUS_LABEL, RequestStatusChip, TZ } from './status';

const COLUMNS: DataColumn[] = [
  { key: 'company', label: 'Company' },
  { key: 'status', label: 'Status' },
  { key: 'photos', label: 'Photos', align: 'right', hideBelow: 'sm' },
  { key: 'people', label: 'People', align: 'right', hideBelow: 'sm' },
  { key: 'submitted', label: 'Submitted', hideBelow: 'md' },
  { key: 'updated', label: 'Updated', hideBelow: 'lg' },
];

/** Super Admin > Floors: custom floor requests from every company (SPEC 29.5), newest first. */
export function FloorRequestsList() {
  const [status, setStatus] = useState<FloorRequestStatus[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const needle = useDeferredValue(q).trim().toLowerCase();
  const filters = useMemo(() => ({ status, workspaceId }), [status, workspaceId]);
  const list = useSuperFloorRequests(filters);
  const companies = useSuperCompanies();
  const router = useRouter();

  const all = list.data?.pages.flatMap((p) => p.items) ?? [];
  const rows = all.filter((r) => !needle || r.workspaceName.toLowerCase().includes(needle));
  const state = list.isPending
    ? 'loading'
    : list.isError
      ? 'error'
      : all.length === 0
        ? 'empty'
        : 'ready';
  const filtered = status.length > 0 || !!workspaceId;

  return (
    <RequirePermission anyOf={['platform.companies.read']}>
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Floors"
          description="Office photos companies sent for their own Team Floor. Open a request to copy the AI prompt, upload the floor, place seats and publish."
          className="mb-1"
        />
        <DataTable
          label="Floor requests"
          columns={COLUMNS}
          status={state}
          onRetry={() => void list.refetch()}
          toolbar={
            <>
              <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
                <FilterButton pressed={status.length === 0} onClick={() => setStatus([])}>
                  All
                </FilterButton>
                {FLOOR_REQUEST_STATUSES.map((s) => (
                  <FilterButton
                    key={s}
                    pressed={status.includes(s)}
                    onClick={() =>
                      setStatus((cur) =>
                        cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s],
                      )
                    }
                  >
                    {REQUEST_STATUS_LABEL[s]}
                  </FilterButton>
                ))}
              </div>
              <label className="w-full max-w-56">
                <span className="sr-only">Company</span>
                <NativeSelect
                  size="sm"
                  value={workspaceId ?? ''}
                  onChange={(e) => setWorkspaceId(e.target.value || null)}
                >
                  <option value="">All companies</option>
                  {(companies.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="relative w-full max-w-xs">
                <span className="sr-only">Search companies</span>
                <Search
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted"
                />
                <Input
                  size="sm"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search companies"
                  className="pl-7"
                />
              </label>
              {state === 'ready' && (
                <span className="ml-auto text-xs text-muted tabular" aria-live="polite">
                  {rows.length} {rows.length === 1 ? 'request' : 'requests'}
                </span>
              )}
            </>
          }
          empty={{
            icon: <Building />,
            title: filtered ? 'No requests match these filters' : 'No floor requests yet',
            description: filtered
              ? 'Clear the filters to see every request.'
              : 'When a company admin sends office photos from the Live Team Floor tab, the request appears here.',
            action: filtered ? (
              <Button
                onClick={() => {
                  setStatus([]);
                  setWorkspaceId(null);
                }}
              >
                Clear filters
              </Button>
            ) : undefined,
          }}
        >
          {rows.length === 0 ? (
            <TableRow className="hover:bg-surface">
              <TableCell colSpan={COLUMNS.length} className="py-6 text-center text-sm text-muted">
                Nothing matches “{q}”. Try another company name.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer"
                onClick={() => router.push(`/super-admin/floors/requests/${r.id}`)}
              >
                <TableCell className="max-w-xs py-2">
                  <Link
                    href={`/super-admin/floors/requests/${r.id}`}
                    className="focus-ring rounded-sm font-medium text-fg hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.workspaceName || 'Company'}
                  </Link>
                  {r.createdBy && (
                    <span className="block truncate text-xs text-muted">by {r.createdBy.name}</span>
                  )}
                </TableCell>
                <TableCell className="py-2">
                  <RequestStatusChip status={r.status} />
                </TableCell>
                <TableCell className={cn(columnClass(COLUMNS[2]!), 'tabular py-2')}>
                  {r.images.length}
                </TableCell>
                <TableCell className={cn(columnClass(COLUMNS[3]!), 'tabular py-2')}>
                  {r.headcount}
                </TableCell>
                <TableCell className={cn(columnClass(COLUMNS[4]!), 'py-2 text-fg-secondary')}>
                  {formatDateTimeIn(r.submittedAt, TZ)}
                </TableCell>
                <TableCell className={cn(columnClass(COLUMNS[5]!), 'py-2 text-fg-secondary')}>
                  {formatDateTimeIn(r.updatedAt, TZ)}
                </TableCell>
              </TableRow>
            ))
          )}
        </DataTable>
        {list.hasNextPage && (
          <div className="flex justify-center">
            <Button onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
              Load more requests
            </Button>
          </div>
        )}
      </div>
    </RequirePermission>
  );
}

function FilterButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="focus-ring h-7 rounded-full border border-border bg-surface px-2.5 text-xs font-medium text-fg-secondary transition-colors hover:bg-surface-2 aria-pressed:border-status-indigo-border aria-pressed:bg-accent-soft aria-pressed:text-accent-soft-fg"
    >
      {children}
    </button>
  );
}
