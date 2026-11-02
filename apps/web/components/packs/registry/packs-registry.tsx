'use client';

import { formatInr, type SuperPack } from '@vistar/shared';
import { Package } from 'lucide-react';
import { useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { PageHeader } from '@/components/common/page-header';
import { NavIcon } from '@/components/shell/nav-icon';
import { PLAN_LABELS } from '@/components/packs/industry/pack-meta';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { TableCell, TableRow } from '@/components/ui/table';
import { useSuperPacks } from '@/lib/packs';
import { CompanyUsage } from './company-usage';
import { PlansEditor } from './plans-editor';
import { VersionPreview } from './version-preview';

const COLUMNS: DataColumn[] = [
  { key: 'pack', label: 'Pack' },
  { key: 'version', label: 'Version', hideBelow: 'sm' },
  { key: 'core', label: 'Type', hideBelow: 'md' },
  { key: 'plans', label: 'Plans', hideBelow: 'lg' },
  { key: 'price', label: 'Add-on price', align: 'right', hideBelow: 'md' },
  { key: 'installs', label: 'Active installs', align: 'right', hideBelow: 'sm' },
  { key: 'open', label: 'Details', align: 'right' },
];

/** Super Admin > Industry packs: registry, version preview, plan entitlements and per-company overrides. */
export function PacksRegistry() {
  return (
    <RequirePermission anyOf={['platform.packs.manage']}>
      <Registry />
    </RequirePermission>
  );
}

function Registry() {
  const q = useSuperPacks();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const packs = q.data ?? [];
  const selected = packs.find((p) => p.key === selectedKey) ?? packs.find((p) => !p.core) ?? packs[0] ?? null;
  const status = q.isPending ? 'loading' : q.isError ? 'error' : packs.length === 0 ? 'empty' : 'ready';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Industry packs" description="Packs and versions in the registry, which plans include them, and which companies use them." className="mb-1" />
      <DataTable
        label="Industry pack registry"
        columns={COLUMNS}
        status={status}
        onRetry={() => void q.refetch()}
        empty={{ icon: <Package />, title: 'No packs in the registry', description: 'Run the pack sync to register packs/*/manifest.json.' }}
        skeletonRows={3}
      >
        {packs.map((p) => {
          const isSelected = selected?.key === p.key;
          return (
            <TableRow key={p.key} data-state={isSelected ? 'selected' : undefined}>
              <TableCell className="max-w-64">
                <span className="flex min-w-0 items-center gap-2">
                  <NavIcon name={p.icon} fallback="Package" className="text-fg-secondary" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name}</span>
                    <code className="block truncate font-mono text-2xs text-muted-strong">{p.key}</code>
                  </span>
                </span>
              </TableCell>
              <TableCell className={`${columnClass(COLUMNS[1]!)} tabular`}>
                {p.latestVersion}
                {p.versions.length > 1 && <span className="ml-1 text-xs text-muted-strong">({p.versions.length} versions)</span>}
              </TableCell>
              <TableCell className={columnClass(COLUMNS[2]!)}>{p.core ? <Chip tone="indigo">Core</Chip> : <Chip tone="neutral">Add-on</Chip>}</TableCell>
              <TableCell className={columnClass(COLUMNS[3]!)}>
                {p.core ? (
                  <span className="text-fg-secondary">Every plan</span>
                ) : p.plans.length === 0 ? (
                  <span className="text-muted-strong">Grant only</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {p.plans.map((plan) => (
                      <Chip key={plan}>{PLAN_LABELS[plan]}</Chip>
                    ))}
                  </span>
                )}
              </TableCell>
              <TableCell className={`${columnClass(COLUMNS[4]!)} tabular`}>{p.priceInrMonthly === null ? <span className="text-muted-strong">Included</span> : `${formatInr(p.priceInrMonthly)}/mo`}</TableCell>
              <TableCell className={`${columnClass(COLUMNS[5]!)} tabular`}>{p.installs.active}</TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant={isSelected ? 'primary' : 'secondary'} aria-pressed={isSelected} onClick={() => setSelectedKey(p.key)} aria-label={`Details of ${p.name}`}>
                  Details
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </DataTable>

      {selected && <PackDetail key={selected.key} pack={selected} />}
    </div>
  );
}

function PackDetail({ pack }: { pack: SuperPack }) {
  return (
    <section aria-labelledby="pack-detail-heading" className="flex flex-col gap-4">
      <Card className="flex flex-col gap-1 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <NavIcon name={pack.icon} fallback="Package" className="size-5 text-fg-secondary" />
          <h2 id="pack-detail-heading" className="text-base font-semibold text-fg">
            {pack.name}
          </h2>
          <Chip tone={pack.core ? 'indigo' : 'neutral'}>{pack.core ? 'Core' : 'Add-on'}</Chip>
          <span className="text-xs text-muted">
            {pack.industry} · v{pack.latestVersion} · {pack.installs.active} active of {pack.installs.total} installed
          </span>
        </div>
        <p className="text-sm text-fg-secondary">{pack.description}</p>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <VersionPreview pack={pack} />
        <PlansEditor pack={pack} />
      </div>
      <CompanyUsage pack={pack} />
    </section>
  );
}
