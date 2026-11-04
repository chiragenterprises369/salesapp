'use client';

import { Switch } from '@/components/common/switch';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/branding/http';
import { readCompanySwitches, useCompanySwitches, useSetCompanySwitch, type CompanySwitches } from '@/lib/branding/platform-config';
import { PlatformSection, type ExtraColumn } from './platform-section';

const LABEL: Record<keyof CompanySwitches, string> = { customDomain: 'Custom domain', fieldTracking: 'Field tracking' };

function CompanySwitch({ id, name, k }: { id: string; name: string; k: keyof CompanySwitches }) {
  const switches = useCompanySwitches();
  const set = useSetCompanySwitch();
  const current = switches.data?.[id] ?? { ...readCompanySwitches(id), overrides: {} };
  const pending = set.isPending && set.variables?.workspaceId === id && set.variables.key === k;
  const checked = pending ? set.variables!.value : current[k];
  return (
    <Switch
      checked={checked}
      disabled={switches.isPending || pending}
      aria-label={`${LABEL[k]} for ${name}`}
      onCheckedChange={(value) =>
        set.mutate(
          { workspaceId: id, key: k, value, overrides: current.overrides },
          {
            onSuccess: () => toast.success(`${LABEL[k]} ${value ? 'on' : 'off'} for ${name}`),
            onError: (e) => toast.error(errorMessage(e, `${LABEL[k]} was not changed. Try again.`)),
          },
        )
      }
    />
  );
}

const nameOf = (cells: Record<string, unknown>) => {
  const c = cells.company;
  return typeof c === 'string' ? c : ((c as { text?: string } | undefined)?.text ?? 'this company');
};

const SWITCH_COLUMNS: ExtraColumn[] = (['customDomain', 'fieldTracking'] as const).map((k) => ({
  key: k,
  label: LABEL[k],
  hideBelow: 'md' as const,
  render: (row) => <CompanySwitch id={row.id} name={nameOf(row.cells)} k={k} />,
}));

/** Super Admin > Companies with the per-company switches (SPEC 29.4, 29.6): custom domain and field tracking. */
export function CompaniesSection() {
  return (
    <PlatformSection
      section="companies"
      title="Companies"
      description="Every workspace on Tootodo with plan, status and usage. Custom domains are off until you switch them on for a company."
      icon="Building2"
      searchLabel="Search companies"
      columns={[
        { key: 'company', label: 'Company' },
        { key: 'plan', label: 'Plan' },
        { key: 'status', label: 'Status' },
        { key: 'seats', label: 'Seats', align: 'right', hideBelow: 'sm' },
        { key: 'leads', label: 'Leads', align: 'right', hideBelow: 'md' },
        { key: 'created', label: 'Created', hideBelow: 'lg' },
      ]}
      extraColumns={SWITCH_COLUMNS}
      rowHref={(row) => `/super-admin/companies/${encodeURIComponent(row.id)}`}
      emptyTitle="No companies yet"
      emptyDescription="Companies appear here when they sign up or when you create one."
    />
  );
}
