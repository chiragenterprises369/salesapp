import { LEAD_IMPORT_FIELDS } from '@vistar/shared';

/** Lead fields an inbound payload can fill, with the labels the mapping editor shows. */
export const LEAD_FIELD_LABEL: Record<(typeof LEAD_IMPORT_FIELDS)[number], string> = {
  name: 'Name',
  companyName: 'Company name',
  phone: 'Phone',
  email: 'Email',
  city: 'City',
  state: 'State',
  source: 'Source',
  sourceRef: 'Source reference (enquiry id)',
  productInterest: 'Product interest',
  requirement: 'Requirement',
  valueInr: 'Value (₹)',
  tags: 'Tags',
  ownerEmail: 'Owner (email)',
  stageName: 'Stage (name)',
};

export const TRANSFORM_LABEL: Record<string, string> = {
  none: 'As is',
  trim: 'Trim spaces',
  lower: 'lower case',
  upper: 'UPPER CASE',
  phone_in: 'Indian phone (+91)',
  number: 'Number (₹1,25,000 to 125000)',
  first_name: 'First name (before the first space)',
  last_name: 'Last name (after the first space)',
};

export interface TargetOption {
  value: string;
  label: string;
  group: 'Lead' | 'Custom fields';
}

/** Lead fields, then the workspace's lead custom fields as `custom.<key>`. */
export function mappingTargets(custom: ReadonlyArray<{ key: string; label: string }>): TargetOption[] {
  return [
    ...LEAD_IMPORT_FIELDS.map((f) => ({ value: f, label: LEAD_FIELD_LABEL[f], group: 'Lead' as const })),
    ...custom.map((c) => ({ value: `custom.${c.key}`, label: c.label, group: 'Custom fields' as const })),
  ];
}

export const targetLabel = (targets: readonly TargetOption[], value: string) => targets.find((t) => t.value === value)?.label ?? value;
