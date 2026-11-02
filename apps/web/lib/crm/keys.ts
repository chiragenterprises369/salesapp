/**
 * Query keys of the CRM modules. The first segment is a SYNC_SCOPES value ('contacts', 'accounts',
 * 'deals', 'products', 'quotations', 'invoices', 'calendar', 'routing', 'capture-forms', 'workspace'),
 * so realtime resyncs and `useCrmRealtime` invalidate them by prefix.
 */
export const crmKeys = {
  contacts: {
    all: ['contacts'] as const,
    list: (q: object) => ['contacts', 'list', q] as const,
    detail: (id: string) => ['contacts', 'detail', id] as const,
    related: (id: string) => ['contacts', 'related', id] as const,
    timeline: (id: string) => ['contacts', 'timeline', id] as const,
    duplicates: (id: string) => ['contacts', 'duplicates', id] as const,
  },
  accounts: {
    all: ['accounts'] as const,
    list: (q: object) => ['accounts', 'list', q] as const,
    detail: (id: string) => ['accounts', 'detail', id] as const,
    related: (id: string) => ['accounts', 'related', id] as const,
    timeline: (id: string) => ['accounts', 'timeline', id] as const,
    duplicates: (id: string) => ['accounts', 'duplicates', id] as const,
  },
  deals: {
    all: ['deals'] as const,
    pipelines: () => ['deals', 'pipelines'] as const,
    list: (q: object) => ['deals', 'list', q] as const,
    boards: () => ['deals', 'board'] as const,
    board: (q: object) => ['deals', 'board', q] as const,
    detail: (id: string) => ['deals', 'detail', id] as const,
    related: (id: string) => ['deals', 'related', id] as const,
    timeline: (id: string) => ['deals', 'timeline', id] as const,
  },
  products: {
    all: ['products'] as const,
    list: (q: object) => ['products', 'list', q] as const,
    detail: (id: string) => ['products', 'detail', id] as const,
    priceLists: () => ['products', 'price-lists'] as const,
    priceList: (id: string) => ['products', 'price-list', id] as const,
  },
  billing: { profile: () => ['workspace', 'seller-profile'] as const },
  quotations: {
    all: ['quotations'] as const,
    list: (q: object) => ['quotations', 'list', q] as const,
    detail: (id: string) => ['quotations', 'detail', id] as const,
  },
  invoices: {
    all: ['invoices'] as const,
    list: (q: object) => ['invoices', 'list', q] as const,
    detail: (id: string) => ['invoices', 'detail', id] as const,
  },
  calendar: {
    all: ['calendar'] as const,
    meetings: (q: object) => ['calendar', 'meetings', q] as const,
    meeting: (id: string) => ['calendar', 'meeting', id] as const,
    availability: (q: object) => ['calendar', 'availability', q] as const,
    timeOff: (q: object) => ['calendar', 'time-off', q] as const,
  },
  routing: { all: ['routing'] as const, rules: () => ['routing', 'rules'] as const },
  capture: {
    all: ['capture-forms'] as const,
    list: () => ['capture-forms', 'list'] as const,
    detail: (id: string) => ['capture-forms', 'detail', id] as const,
    submissions: (id: string) => ['capture-forms', 'submissions', id] as const,
  },
};
