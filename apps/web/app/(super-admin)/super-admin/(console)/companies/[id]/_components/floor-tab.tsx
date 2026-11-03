'use client';

import type { Company } from '@vistar/shared';
import { Building, Layers } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { useCompanyFloors, useSuperFloorRequests } from '../../../floors/_components/data';
import { AssetStatusChip, FORMAT_LABEL, RequestStatusChip } from '../../../floors/_components/status';
import { when } from './overview-tab';

const REQUEST_COLUMNS: DataColumn[] = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'status', label: 'Status' },
  { key: 'photos', label: 'Photos', align: 'right', hideBelow: 'sm' },
  { key: 'people', label: 'People', align: 'right', hideBelow: 'sm' },
  { key: 'by', label: 'Sent by', hideBelow: 'md' },
  { key: 'updated', label: 'Updated', hideBelow: 'lg' },
];

const VERSION_COLUMNS: DataColumn[] = [
  { key: 'version', label: 'Version' },
  { key: 'status', label: 'Status' },
  { key: 'format', label: 'Format', hideBelow: 'sm' },
  { key: 'seats', label: 'Seats', align: 'right', hideBelow: 'md' },
  { key: 'created', label: 'Uploaded', hideBelow: 'lg' },
];

/** Custom floor requests and floor versions of one company (links into Super Admin > Floors). */
export function CompanyFloorTab({ company: c }: { company: Company }) {
  const router = useRouter();
  const filters = useMemo(() => ({ status: [], workspaceId: c.id }), [c.id]);
  const requests = useSuperFloorRequests(filters);
  const versions = useCompanyFloors(c.id);
  const rows = requests.data?.pages.flatMap((p) => p.items) ?? [];
  const reqStatus = requests.isPending ? 'loading' : requests.isError ? 'error' : rows.length === 0 ? 'empty' : 'ready';
  const vRows = versions.data ?? [];
  const vStatus = versions.isPending && versions.fetchStatus !== 'idle' ? 'loading' : versions.isError ? 'error' : vRows.length === 0 ? 'empty' : 'ready';

  return (
    <div className="grid items-start gap-4 2xl:grid-cols-2">
      <section aria-labelledby="cf-requests" className="flex min-w-0 flex-col gap-2">
        <h2 id="cf-requests" className="text-base font-semibold text-fg">
          Floor requests
        </h2>
        <DataTable
          label={`Floor requests of ${c.name}`}
          columns={REQUEST_COLUMNS}
          status={reqStatus}
          onRetry={() => void requests.refetch()}
          empty={{ icon: <Building />, title: 'No floor requests', description: 'The company sends office photos from its Live Team Floor tab; the request appears here and in Floors.' }}
        >
          {rows.map((r) => (
            <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/super-admin/floors/requests/${r.id}`)}>
              <TableCell className="py-2">
                <Link href={`/super-admin/floors/requests/${r.id}`} className="focus-ring rounded-sm font-medium text-fg hover:underline" onClick={(e) => e.stopPropagation()}>
                  {when(r.submittedAt)}
                </Link>
              </TableCell>
              <TableCell className="py-2">
                <RequestStatusChip status={r.status} />
              </TableCell>
              <TableCell className={cn(columnClass(REQUEST_COLUMNS[2]!), 'tabular py-2')}>{r.images.length}</TableCell>
              <TableCell className={cn(columnClass(REQUEST_COLUMNS[3]!), 'tabular py-2')}>{r.headcount}</TableCell>
              <TableCell className={cn(columnClass(REQUEST_COLUMNS[4]!), 'py-2 text-fg-secondary')}>{r.createdBy?.name ?? '–'}</TableCell>
              <TableCell className={cn(columnClass(REQUEST_COLUMNS[5]!), 'py-2 text-fg-secondary')}>{when(r.updatedAt)}</TableCell>
            </TableRow>
          ))}
        </DataTable>
        {requests.hasNextPage && (
          <Button className="self-center" onClick={() => void requests.fetchNextPage()} loading={requests.isFetchingNextPage}>
            Load more requests
          </Button>
        )}
      </section>

      <section aria-labelledby="cf-versions" className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="cf-versions" className="text-base font-semibold text-fg">
            Floor versions
          </h2>
          <Button asChild size="sm" variant="ghost" className="ml-auto">
            <Link href="/super-admin/floors">Open Floors</Link>
          </Button>
        </div>
        <DataTable
          label={`Floor versions of ${c.name}`}
          columns={VERSION_COLUMNS}
          status={vStatus}
          onRetry={() => void versions.refetch()}
          empty={{ icon: <Layers />, title: 'No custom floor yet', description: 'The company uses a default template until you upload and publish a floor in Floors.' }}
        >
          {vRows.map((v) => (
            <TableRow key={v.id} className="cursor-pointer" onClick={() => router.push(`/super-admin/floors/versions/${v.id}`)}>
              <TableCell className="py-2">
                <Link href={`/super-admin/floors/versions/${v.id}`} className="focus-ring rounded-sm font-medium text-fg hover:underline" onClick={(e) => e.stopPropagation()}>
                  {`Version ${v.version}`}
                </Link>
              </TableCell>
              <TableCell className="py-2">
                <AssetStatusChip status={v.status} />
              </TableCell>
              <TableCell className={cn(columnClass(VERSION_COLUMNS[2]!), 'py-2 text-fg-secondary')}>{FORMAT_LABEL[v.format]}</TableCell>
              <TableCell className={cn(columnClass(VERSION_COLUMNS[3]!), 'tabular py-2')}>{v.seatCount}</TableCell>
              <TableCell className={cn(columnClass(VERSION_COLUMNS[4]!), 'py-2 text-fg-secondary')}>{when(v.createdAt)}</TableCell>
            </TableRow>
          ))}
        </DataTable>
      </section>
    </div>
  );
}
