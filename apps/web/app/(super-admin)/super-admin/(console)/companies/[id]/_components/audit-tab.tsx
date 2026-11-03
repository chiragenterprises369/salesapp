'use client';

import type { Company } from '@vistar/shared';
import { ScrollText } from 'lucide-react';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { companyAuditAvailable, useCompanyAudit } from '@/lib/config/company-detail';
import { ACTION_LABEL } from '@/lib/world/platform';
import { when } from './overview-tab';

const COLUMNS: DataColumn[] = [
  { key: 'time', label: 'Time' },
  { key: 'admin', label: 'Admin' },
  { key: 'action', label: 'Action' },
  { key: 'item', label: 'Item', hideBelow: 'md' },
  { key: 'reason', label: 'Reason', hideBelow: 'lg' },
];

const actionText = (action: string) => ACTION_LABEL[action] ?? action.replaceAll('_', ' ').replaceAll('.', ': ');

/** Platform audit entries for one company (plan changes, flags, support sessions, floors, config). */
export function CompanyAuditTab({ company: c }: { company: Company }) {
  const q = useCompanyAudit(c.id);
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const available = companyAuditAvailable();
  const status = q.isPending ? 'loading' : q.isError ? 'error' : rows.length === 0 ? 'empty' : 'ready';
  return (
    <div className="flex flex-col gap-3">
      <DataTable
        label={`Audit log of ${c.name}`}
        columns={COLUMNS}
        status={status}
        onRetry={() => void q.refetch()}
        empty={{
          icon: <ScrollText />,
          title: available ? 'No platform actions for this company yet' : 'The platform audit log is not available on this server yet',
          description: available
            ? 'Plan changes, switches, support sessions and floor work on this company appear here.'
            : 'It arrives with the next API update. The company still sees its own audit log in Settings.',
        }}
      >
        {rows.map((a) => (
          <TableRow key={a.id}>
            <TableCell className="py-2 whitespace-nowrap text-fg-secondary">{when(a.createdAt)}</TableCell>
            <TableCell className="py-2">{a.adminName ?? 'System'}</TableCell>
            <TableCell className="py-2 font-medium text-fg">{actionText(a.action)}</TableCell>
            <TableCell className={cn(columnClass(COLUMNS[3]!), 'py-2 text-fg-secondary')}>{a.entityType}</TableCell>
            <TableCell className={cn(columnClass(COLUMNS[4]!), 'max-w-md truncate py-2 text-fg-secondary')}>{a.reason ?? '–'}</TableCell>
          </TableRow>
        ))}
      </DataTable>
      {q.hasNextPage && (
        <Button className="self-center" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
          Load older entries
        </Button>
      )}
    </div>
  );
}
