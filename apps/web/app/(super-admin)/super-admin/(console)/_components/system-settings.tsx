'use client';

import { SUPER_SESSION } from '@vistar/shared';
import { DataTable, columnClass, type DataColumn } from '@/components/common/data-table';
import { PageHeader } from '@/components/common/page-header';
import { formatDateTimeIn } from '@/components/common/time';
import { Avatar } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { TableCell, TableRow } from '@/components/ui/table';
import { useSession } from '@/lib/session/session';

const COLUMNS: DataColumn[] = [
  { key: 'admin', label: 'Platform admin' },
  { key: 'email', label: 'Email', hideBelow: 'sm' },
  { key: 'mfa', label: 'Two-step' },
  { key: 'ip', label: 'IP allowlist', hideBelow: 'md' },
  { key: 'last', label: 'Last sign-in', hideBelow: 'lg' },
];

const POLICY = [
  { label: 'Access token lifetime', value: `${SUPER_SESSION.accessTtlSec / 60} minutes` },
  { label: 'Sign out after inactivity', value: `${SUPER_SESSION.idleTimeoutSec / 60} minutes` },
  { label: 'Maximum session length', value: `${SUPER_SESSION.absoluteTimeoutSec / 3600} hours` },
  { label: 'Two-step verification', value: 'Required for every admin' },
];

/** System settings: session policy (read-only constants) and platform admins (you, until Phase 9 lists all). */
export function SystemSettings() {
  const session = useSession();
  const admin = session?.audience === 'platform' ? session.admin : null;
  return (
    <div className="flex max-w-7xl flex-col gap-4">
      <PageHeader title="System settings" description="Session security for the console and the people who can use it." className="mb-1" />
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Session policy</CardTitle>
            <CardDescription>Enforced by the platform API for every Super Admin.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            {POLICY.map((p) => (
              <div key={p.label}>
                <dt className="text-xs text-muted">{p.label}</dt>
                <dd className="text-sm font-medium text-fg">{p.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <DataTable label="Platform admins" columns={COLUMNS} status={admin ? 'ready' : 'loading'} skeletonRows={1} empty={{ title: 'No admins' }}>
        {admin && (
          <TableRow>
            <TableCell>
              <span className="inline-flex items-center gap-2 font-medium">
                <Avatar name={admin.name} size="xs" />
                {admin.name}
                <Chip tone="indigo">You</Chip>
              </span>
            </TableCell>
            <TableCell className={columnClass(COLUMNS[1]!)}>{admin.email}</TableCell>
            <TableCell>
              <Chip tone={admin.mfaEnabled ? 'green' : 'red'} dot>
                {admin.mfaEnabled ? 'On' : 'Off'}
              </Chip>
            </TableCell>
            <TableCell className={`${columnClass(COLUMNS[3]!)} text-fg-secondary`}>{admin.ipAllowlist.length ? admin.ipAllowlist.join(', ') : 'Any IP'}</TableCell>
            <TableCell className={`${columnClass(COLUMNS[4]!)} text-fg-secondary`}>
              {admin.lastLoginAt ? formatDateTimeIn(admin.lastLoginAt, 'Asia/Kolkata') : 'Never'}
            </TableCell>
          </TableRow>
        )}
      </DataTable>
    </div>
  );
}
