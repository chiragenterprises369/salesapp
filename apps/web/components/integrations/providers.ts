import type { IntegrationField } from '@vistar/shared';
import { CalendarDays, Mail, MessageCircle, PhoneCall, Plug, Store, type LucideIcon } from 'lucide-react';
import { createElement } from 'react';

/**
 * Web-side presentation of the provider catalog (GET /integrations/catalog carries the fields, setup
 * steps and capabilities): icons, category names, and form value helpers.
 */
export const PROVIDER_ICON: Record<string, LucideIcon> = {
  indiamart: Store,
  whatsapp_cloud: MessageCircle,
  telephony: PhoneCall,
  smtp: Mail,
  google_calendar: CalendarDays,
};
const providerIcon = (provider: string): LucideIcon => PROVIDER_ICON[provider] ?? Plug;

/** Decorative provider icon (same pattern as NavIcon: a static lookup, not a component made in render). */
export function ProviderIcon({ provider, className }: { provider: string; className?: string }) {
  return createElement(providerIcon(provider), { 'aria-hidden': true, className });
}

export const CATEGORY_LABEL: Record<string, string> = { leads: 'Lead source', messaging: 'Messaging', calls: 'Calling', email: 'Email', calendar: 'Calendar' };

/** Form value of a field: strings for text-like inputs, booleans for switches, string lists for tags. */
export type FieldValue = string | boolean | string[];

/** Initial form value from the saved config or the field default. */
export function initialFieldValue(f: IntegrationField, saved: unknown): FieldValue {
  const v = saved !== undefined && saved !== null ? saved : f.default;
  if (f.type === 'boolean') return v === true;
  if (f.type === 'tags') return Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (v === undefined || v === null) return f.type === 'select' ? (f.options?.[0]?.value ?? '') : '';
  return String(v);
}

/** Form value -> config value (numbers as numbers; empty strings left out so the server default applies). */
export function configValue(f: IntegrationField, v: FieldValue | undefined): unknown {
  if (f.type === 'boolean') return v === true;
  if (f.type === 'tags') return Array.isArray(v) ? v : [];
  if (v === undefined || v === '' || Array.isArray(v) || typeof v === 'boolean') return undefined;
  if (f.type === 'number') return Number(v);
  return v.trim();
}

/** Fields visible for the current values (`showIf`). */
export function visibleFields(fields: readonly IntegrationField[], values: Record<string, FieldValue>): IntegrationField[] {
  return fields.filter((f) => !f.showIf || values[f.showIf.key] === f.showIf.equals);
}
