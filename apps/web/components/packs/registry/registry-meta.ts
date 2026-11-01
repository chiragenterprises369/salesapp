import type { ChipTone, PackCompanyUsage, PackEntitlement } from '@vistar/shared';

export const ENTITLEMENT_CHIP: Record<PackEntitlement, { label: string; tone: ChipTone }> = {
  core: { label: 'Core', tone: 'neutral' },
  plan: { label: 'From plan', tone: 'green' },
  grant: { label: 'Granted', tone: 'indigo' },
  none: { label: 'Not in plan', tone: 'grey' },
  revoked: { label: 'Revoked', tone: 'red' },
};

export const USAGE_STATUS_CHIP: Record<PackCompanyUsage['status'], { label: string; tone: ChipTone }> = {
  not_installed: { label: 'Not installed', tone: 'grey' },
  active: { label: 'Active', tone: 'green' },
  uninstalled: { label: 'Uninstalled', tone: 'grey' },
  failed: { label: 'Failed', tone: 'red' },
};

export type OverrideAction = 'grant' | 'revoke' | 'follow';

export const OVERRIDE_COPY: Record<OverrideAction, { button: string; title: (pack: string, company: string) => string; body: string; confirm: string; done: (pack: string, company: string) => string }> = {
  grant: {
    button: 'Grant',
    title: (p, c) => `Grant ${p} to ${c}?`,
    body: 'The company can install and use the pack even if its plan does not include it.',
    confirm: 'Grant access',
    done: (p, c) => `${p} granted to ${c}`,
  },
  revoke: {
    button: 'Revoke',
    title: (p, c) => `Revoke ${p} for ${c}?`,
    body: 'The pack leaves their navigation and pages. Their data is kept and comes back if access returns.',
    confirm: 'Revoke access',
    done: (p, c) => `${p} revoked for ${c}`,
  },
  follow: {
    button: 'Follow plan',
    title: (p, c) => `Let ${c} follow its plan for ${p}?`,
    body: 'Removes the override. Access then depends only on the plans that include the pack.',
    confirm: 'Follow plan',
    done: (p, c) => `${c} now follows its plan for ${p}`,
  },
};

/** Item count labels for manifest summaries. */
export const SUMMARY_TITLES: Record<string, string> = {
  objects: 'Objects',
  fields: 'Fields',
  pipelines: 'Pipelines',
  stages: 'Stages',
  roles: 'Roles',
  workflowTemplates: 'Workflow templates',
  whatsappTemplates: 'WhatsApp templates',
  dashboardWidgets: 'Dashboard widgets',
  reports: 'Reports',
  importMappings: 'Import mappings',
  navigation: 'Pages',
  mapLayers: 'Map layers',
};
