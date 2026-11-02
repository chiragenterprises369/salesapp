/** CRM event type -> query scopes to refresh (first query-key segment). */
const PREFIX_SCOPES: Record<string, readonly string[]> = {
  contact: ['contacts', 'accounts', 'deals'],
  account: ['accounts', 'contacts', 'deals'],
  deal: ['deals', 'contacts', 'accounts'],
  quotation: ['quotations', 'deals', 'contacts', 'accounts'],
  invoice: ['invoices', 'quotations', 'deals', 'contacts', 'accounts'],
  catalog: ['products'],
  meeting: ['calendar', 'contacts', 'accounts', 'deals'],
};

export function scopesForCrmEvent(type: string): readonly string[] {
  return PREFIX_SCOPES[type.split('.')[0] ?? ''] ?? [];
}
