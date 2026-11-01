import { isEntitled, type ChipTone, type PackEntitlement, type PackListItem, type Plan } from '@vistar/shared';

export type PackDisplayStatus = 'active' | 'available' | 'locked' | 'uninstalled' | 'failed';

/** A pack the company may not use is "locked", whatever was installed before (its data is kept). */
export function displayStatus(p: Pick<PackListItem, 'status' | 'entitlement'>): PackDisplayStatus {
  if (!isEntitled(p.entitlement) || p.status === 'locked') return 'locked';
  return p.status;
}

export const STATUS_CHIP: Record<PackDisplayStatus, { label: string; tone: ChipTone }> = {
  active: { label: 'Active', tone: 'green' },
  available: { label: 'Available', tone: 'neutral' },
  locked: { label: 'Locked', tone: 'grey' },
  uninstalled: { label: 'Uninstalled', tone: 'grey' },
  failed: { label: 'Failed', tone: 'red' },
};

export const PLAN_LABELS: Record<Plan, string> = { free: 'Free', starter: 'Starter', growth: 'Growth', enterprise: 'Enterprise' };

export function entitlementText(e: PackEntitlement, plan: Plan): string {
  switch (e) {
    case 'core':
      return 'Included in every plan';
    case 'plan':
      return `Included in your ${PLAN_LABELS[plan]} plan`;
    case 'grant':
      return 'Turned on for your company by Vistar support';
    case 'none':
      return `Not included in your ${PLAN_LABELS[plan]} plan`;
    case 'revoked':
      return 'Turned off for your company by Vistar support';
  }
}

const SUMMARY_LABELS: Record<string, [string, string]> = {
  objects: ['object', 'objects'],
  fields: ['field', 'fields'],
  pipelines: ['pipeline', 'pipelines'],
  stages: ['stage', 'stages'],
  roles: ['role', 'roles'],
  workflowTemplates: ['workflow template', 'workflow templates'],
  whatsappTemplates: ['WhatsApp template', 'WhatsApp templates'],
  dashboardWidgets: ['dashboard widget', 'dashboard widgets'],
  reports: ['report', 'reports'],
  importMappings: ['import mapping', 'import mappings'],
  navigation: ['page', 'pages'],
  mapLayers: ['map layer', 'map layers'],
};

/** "3 fields", "1 pipeline", ... for the non-zero counts of manifestSummary(). */
export function summaryItems(summary: Record<string, number>): string[] {
  return Object.entries(summary)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => {
      const [one, many] = SUMMARY_LABELS[k] ?? [k, k];
      return `${n} ${n === 1 ? one : many}`;
    });
}

/** Group planned ops for the preview. */
export type ChangeGroup = 'add' | 'update' | 'archive' | 'restore';
export function changeGroup(op: string): ChangeGroup {
  if (op.endsWith('.create')) return 'add';
  if (op.endsWith('.archive')) return 'archive';
  if (op.endsWith('.restore')) return 'restore';
  return 'update';
}

/** "2 added, 1 archived" from a summary of op counts ({ "field.create": 2 }). */
export function describeSummary(summary: Record<string, number>): string {
  const totals: Record<ChangeGroup, number> = { add: 0, update: 0, archive: 0, restore: 0 };
  for (const [op, n] of Object.entries(summary)) if (op !== 'conflict') totals[changeGroup(op)] += n;
  const parts = [
    totals.add && `${totals.add} added`,
    totals.update && `${totals.update} updated`,
    totals.archive && `${totals.archive} archived`,
    totals.restore && `${totals.restore} restored`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'No changes';
}
