'use client';

import { DATA_SCOPES, ROLE_KIND_LABELS, type RoleKind } from '@vistar/shared';
import Link from 'next/link';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { TableCell, TableRow } from '@/components/ui/table';
import { SCOPE_LABELS, useRolesStore } from './roles-store';
import { SettingsCard } from './settings-card';

const PANEL: Record<RoleKind, string> = {
  company_admin: 'Company panel',
  manager: 'Company panel and My workspace',
  employee: 'Employee panel',
  viewer: 'Company panel',
};

const COLUMNS: DataColumn[] = [
  { key: 'role', label: 'Role' },
  { key: 'scope', label: 'Can see' },
  { key: 'detail', label: 'In practice', hideBelow: 'lg' },
  { key: 'panel', label: 'Opens', hideBelow: 'md' },
  { key: 'members', label: 'People', align: 'right', hideBelow: 'sm' },
];

const APPLIES_TO = [
  { area: 'Leads', rule: 'the lead owner' },
  { area: 'Tasks', rule: 'the person the task is assigned to' },
  { area: 'Calls', rule: 'the person who made or took the call' },
  { area: 'WhatsApp chats', rule: 'the assigned person' },
  { area: 'Dashboard, reports and Team Floor', rule: 'built only from records the role can see' },
];

/** Per-role data scope summary (read from the same roles as Roles and permissions). */
export function DataVisibility() {
  const roles = useRolesStore((s) => s.roles);
  return (
    <>
      <DataTable label="Data visibility by role" columns={COLUMNS} status="ready" empty={{ title: 'No roles' }}>
        {roles.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-medium">
              <span className="inline-flex items-center gap-2">
                {r.name}
                {!r.isSystem && <Chip>Custom</Chip>}
              </span>
            </TableCell>
            <TableCell>
              <Chip tone={r.dataScope === 'all' ? 'indigo' : r.dataScope === 'team' ? 'blue' : 'neutral'}>{SCOPE_LABELS[r.dataScope].label}</Chip>
            </TableCell>
            <TableCell className={`${columnClass(COLUMNS[2]!)} py-2 whitespace-normal text-fg-secondary`}>{SCOPE_LABELS[r.dataScope].sentence}</TableCell>
            <TableCell className={`${columnClass(COLUMNS[3]!)} py-2 whitespace-normal text-fg-secondary`}>{PANEL[r.kind]}</TableCell>
            <TableCell className={`${columnClass(COLUMNS[4]!)} tabular`}>{r.memberCount}</TableCell>
          </TableRow>
        ))}
      </DataTable>
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingsCard title="How visibility works" description="Tootodo checks every list, detail page, report and live update against the role's scope.">
          <dl className="flex flex-col gap-3">
            {DATA_SCOPES.map((s) => (
              <div key={s}>
                <dt className="text-sm font-medium text-fg">{SCOPE_LABELS[s].label}</dt>
                <dd className="text-xs text-muted">{SCOPE_LABELS[s].sentence}.</dd>
              </div>
            ))}
          </dl>
        </SettingsCard>
        <SettingsCard
          title="Which records count as theirs"
          description={`Default scopes: ${ROLE_KIND_LABELS.employee} sees own records, ${ROLE_KIND_LABELS.manager} sees their team, admins and viewers see everything.`}
          footer={
            <Button asChild>
              <Link href="/app/settings/roles">Change scopes in Roles and permissions</Link>
            </Button>
          }
        >
          <ul className="flex flex-col gap-1.5 text-sm">
            {APPLIES_TO.map((a) => (
              <li key={a.area} className="flex flex-wrap gap-x-1">
                <span className="font-medium text-fg">{a.area}:</span>
                <span className="text-fg-secondary">{a.rule}</span>
              </li>
            ))}
          </ul>
        </SettingsCard>
      </div>
    </>
  );
}
