/**
 * Query keys of the integration hub pages. The first segment is the cache scope that realtime
 * events invalidate ('integrations', 'webhooks', 'api-keys'; see lib/hub/realtime.ts).
 */
export const hubKeys = {
  integrations: {
    all: ['integrations'] as const,
    list: () => ['integrations', 'list'] as const,
    catalog: () => ['integrations', 'catalog'] as const,
  },
  webhooks: {
    all: ['webhooks'] as const,
    endpoints: () => ['webhooks', 'endpoints'] as const,
    endpoint: (id: string) => ['webhooks', 'endpoint', id] as const,
    samples: (id: string) => ['webhooks', 'samples', id] as const,
    deliveries: (q: object) => ['webhooks', 'deliveries', q] as const,
    delivery: (id: string) => ['webhooks', 'delivery', id] as const,
    preview: (q: object) => ['webhooks', 'preview', q] as const,
  },
  apiKeys: {
    all: ['api-keys'] as const,
    list: () => ['api-keys', 'list'] as const,
    scopes: () => ['api-keys', 'scopes'] as const,
  },
  docs: {
    reference: () => ['api-docs', 'openapi'] as const,
  },
};
