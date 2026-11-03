'use client';

import { FEATURE_FLAGS, type Company, type FeatureFlag } from '@vistar/shared';
import { RotateCcw } from 'lucide-react';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { Switch } from '@/components/common/switch';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { TableCell, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { useSetCompanyFlag } from '@/lib/config/company-detail';
import { useCan } from '@/lib/session/session';
import { FLAG_LABEL } from '@/lib/world/platform';

const FLAG_HELP: Record<FeatureFlag, string> = {
  team_floor_3d: 'The 3D Live Team Floor (the flat floor stays available).',
  ai_node: 'AI steps in workflows.',
  telephony: 'Cloud telephony: click-to-call and call recordings through the provider.',
  api_access: 'API keys and the public API.',
  whatsapp: 'WhatsApp inbox, templates and sending.',
  employee_rank: 'Leaderboard ranks shown to employees.',
  custom_domain: 'The company can connect its own domain (Settings, Domain).',
  field_tracking: 'Attendance and GPS for field staff, with consent and inside working hours.',
};

const COLUMNS: DataColumn[] = [
  { key: 'flag', label: 'Feature' },
  { key: 'source', label: 'Source', hideBelow: 'sm' },
  { key: 'on', label: 'On', align: 'right' },
  { key: 'reset', label: 'Plan default', align: 'right', hideBelow: 'md' },
];

/** Per-company switches: every feature flag with its effective value; a change writes an override (audited by the API). */
export function CompanySwitchesTab({ company: c }: { company: Company }) {
  const set = useSetCompanyFlag(c.id);
  const canManage = useCan('platform.flags.manage');

  const change = (flag: FeatureFlag, value: boolean | null) =>
    set.mutate(
      { flag, value },
      {
        onSuccess: () => toast.success(value === null ? `${FLAG_LABEL[flag]} follows the plan again for ${c.name}` : `${FLAG_LABEL[flag]} ${value ? 'on' : 'off'} for ${c.name}`),
        onError: (e) => toast.error(formErrorMessage(e, `${FLAG_LABEL[flag]} was not changed. Try again.`)),
      },
    );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-strong">Overrides win over the plan. Every change is written to the platform audit log and the company sees the new features on its next page load.</p>
      <DataTable label={`Switches for ${c.name}`} columns={COLUMNS} status="ready" empty={{ title: 'No switches' }}>
        {FEATURE_FLAGS.map((f) => {
          const override = c.flagOverrides[f];
          const pending = set.isPending && set.variables?.flag === f;
          const effective = c.features ? c.features[f] : (override ?? false);
          const checked = pending && set.variables?.value !== null ? !!set.variables?.value : effective;
          return (
            <TableRow key={f}>
              <TableCell className="py-2">
                <span className="block font-medium text-fg">{FLAG_LABEL[f]}</span>
                <span className="block text-xs whitespace-normal text-muted">{FLAG_HELP[f]}</span>
              </TableCell>
              <TableCell className={`${columnClass(COLUMNS[1]!)} py-2`}>{override === undefined ? <Chip>Plan</Chip> : <Chip tone="amber">Override</Chip>}</TableCell>
              <TableCell className={`${columnClass(COLUMNS[2]!)} py-2`}>
                <Switch checked={checked} disabled={!canManage || pending} aria-label={`${FLAG_LABEL[f]} for ${c.name}`} onCheckedChange={(v) => change(f, v)} />
              </TableCell>
              <TableCell className={`${columnClass(COLUMNS[3]!)} py-2`}>
                {override !== undefined && (
                  <Button size="sm" variant="ghost" disabled={!canManage || pending} onClick={() => change(f, null)} aria-label={`Reset ${FLAG_LABEL[f]} to the plan default`}>
                    <RotateCcw aria-hidden />
                    Reset
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </DataTable>
    </div>
  );
}
