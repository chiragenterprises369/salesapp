'use client';

import { formatNumber, type ChipTone, type Company, type RoleKind } from '@vistar/shared';
import { Smartphone, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { useCompanyUsers } from '@/lib/config/company-detail';
import { when } from './overview-tab';

const COLUMNS: DataColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'role', label: 'Role' },
  { key: 'status', label: 'Status' },
  { key: 'last', label: 'Last active', hideBelow: 'md' },
  { key: 'devices', label: 'Devices', hideBelow: 'lg' },
  { key: 'created', label: 'Added', hideBelow: 'lg' },
];

const KIND: Record<RoleKind, { text: string; tone: ChipTone }> = {
  company_admin: { text: 'Admin', tone: 'blue' },
  manager: { text: 'Manager', tone: 'green' },
  employee: { text: 'Employee', tone: 'grey' },
  viewer: { text: 'Viewer', tone: 'grey' },
};

/**
 * Users of one company (change #20, GET /api/super/companies/{id}/users): a support view with name, e-mail,
 * role, active state, last activity and registered Android devices. No phone numbers; company admins manage
 * their own team in Team, Users.
 */
export function CompanyUsersTab({ company: c }: { company: Company }) {
  const q = useCompanyUsers(c.id);
  const [search, setSearch] = useState('');
  const all = useMemo(() => q.data ?? [], [q.data]);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? all.filter((u) => u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s)) : all;
  }, [all, search]);
  const active = all.filter((u) => u.isActive).length;
  const status = q.isPending ? 'loading' : q.isError ? 'error' : rows.length === 0 ? 'empty' : 'ready';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-strong" aria-live="polite">
          {q.data ? `${formatNumber(all.length)} ${all.length === 1 ? 'user' : 'users'}, ${formatNumber(active)} active` : `${formatNumber(c.userCount ?? c.usage.seats)} users`}
        </p>
        <Input className="w-full sm:w-72" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or e-mail" aria-label="Search users" />
      </div>
      <DataTable
        label={`Users of ${c.name}`}
        columns={COLUMNS}
        status={status}
        onRetry={() => void q.refetch()}
        empty={{
          icon: <Users />,
          title: search ? 'No user matches this search' : 'No users in this company yet',
          description: search ? 'Try another name or e-mail.' : 'People appear here once the company admin invites them.',
        }}
      >
        {rows.map((u) => {
          const kind = u.roleKind ? KIND[u.roleKind] : null;
          return (
            <TableRow key={u.id}>
              <TableCell className="py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg">{u.name}</p>
                  <p className="truncate text-xs text-muted-strong">{u.email}</p>
                </div>
              </TableCell>
              <TableCell className="py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="truncate text-fg-secondary">{u.roleName ?? 'No role'}</span>
                  {kind && <Chip tone={kind.tone}>{kind.text}</Chip>}
                </div>
              </TableCell>
              <TableCell className="py-2">
                <Chip tone={u.isActive ? 'green' : 'grey'} dot>
                  {u.isActive ? 'Active' : 'Deactivated'}
                </Chip>
              </TableCell>
              <TableCell className={cn(columnClass(COLUMNS[3]!), 'py-2 whitespace-nowrap text-fg-secondary')}>{u.lastActiveAt ? when(u.lastActiveAt) : 'Never'}</TableCell>
              <TableCell className={cn(columnClass(COLUMNS[4]!), 'py-2 text-fg-secondary')}>
                <span className="inline-flex items-center gap-1 tabular">
                  <Smartphone aria-hidden className="size-3.5" />
                  {formatNumber(u.devices)}
                  <span className="sr-only">{u.devices === 1 ? 'device' : 'devices'}</span>
                </span>
              </TableCell>
              <TableCell className={cn(columnClass(COLUMNS[5]!), 'py-2 whitespace-nowrap text-fg-secondary')}>{when(u.createdAt)}</TableCell>
            </TableRow>
          );
        })}
      </DataTable>
    </div>
  );
}
