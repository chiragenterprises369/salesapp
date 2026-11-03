import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { ApiErrorSchema } from '../errors.js';
import * as S from '../index.js';
import { API_BASE_PATH, API_ROUTES, type RouteDef } from './routes.js';

/**
 * Builds the OpenAPI 3.1 document from API_ROUTES. Generated output lives in
 * packages/shared/openapi/openapi.{json,yaml} via `pnpm openapi`. Do not hand-edit the output.
 */
export type OpenApiDocument = ReturnType<OpenApiGeneratorV31['generateDocument']>;

export interface OpenApiOptions {
  serverUrl?: string;
  version?: string;
  /** Keep only these routes (change #19 wave C: the public API document). */
  include?: (id: string, def: RouteDef) => boolean;
  /** Public API document: API key security only, scope wording, no owner/phase notes, unused components pruned. */
  publicApi?: boolean;
}

/** Routes of the public API reference: everything that accepts an API key, plus the inbound webhook for senders. */
export const isPublicApiRoute = (id: string, def: RouteDef): boolean =>
  def.auth === 'api_key' || def.auth === 'jwt_or_api_key' || id === 'inboundWebhook';

/** OpenAPI 3.1 document served at GET /api/v1/openapi.json (change #19 wave C). */
export function buildPublicOpenApiDocument(opts: { serverUrl?: string; version?: string } = {}): OpenApiDocument {
  return buildOpenApiDocument({ ...opts, include: isPublicApiRoute, publicApi: true });
}

export function buildOpenApiDocument(opts: OpenApiOptions = {}): OpenApiDocument {
  const registry = new OpenAPIRegistry();

  registry.registerComponent('securitySchemes', 'bearerJwt', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
  registry.registerComponent('securitySchemes', 'bearerPlatform', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'Super Admin token (audience vistar:platform, 2FA verified). Workspace tokens are rejected.',
  });
  registry.registerComponent('securitySchemes', 'apiKey', {
    type: 'http',
    scheme: 'bearer',
    description: 'Workspace API key (vst_live_...). Scoped; see API key scopes.',
  });
  registry.registerComponent('securitySchemes', 'webhookSignature', {
    type: 'apiKey',
    in: 'header',
    name: 'X-Vistar-Signature',
    description: 't=<unix>,v1=<hex HMAC-SHA256 of "t.rawBody">',
  });

  const errorResponse = { description: 'Error', content: { 'application/json': { schema: ApiErrorSchema } } };

  // Named components so repeated schemas become $refs.
  const components: Record<string, z.ZodType> = {
    ApiError: ApiErrorSchema,
    UserSummary: S.UserSummarySchema,
    User: S.UserSchema,
    Workspace: S.WorkspaceSchema,
    LeadListItem: S.LeadListItemSchema,
    Lead: S.LeadSchema,
    Stage: S.StageSchema,
    Pipeline: S.PipelineSchema,
    Activity: S.ActivitySchema,
    Task: S.TaskSchema,
    Call: S.CallSchema,
    Message: S.MessageSchema,
    Conversation: S.ConversationSchema,
    Template: S.TemplateSchema,
    Notification: S.NotificationSchema,
    AttentionItem: S.AttentionItemSchema,
    WebhookEndpoint: S.WebhookEndpointSchema,
    WebhookDelivery: S.WebhookDeliverySchema,
    Integration: S.IntegrationSchema,
    ApiKey: S.ApiKeySchema,
    WorkflowGraph: S.WorkflowGraphSchema,
    WorkflowRun: S.WorkflowRunSchema,
    WorkflowRunStep: S.WorkflowRunStepSchema,
    Workflow: S.WorkflowSchema,
    MeResponse: S.MeResponseSchema,
    StoredFile: S.StoredFileSchema,
    FileRef: S.FileRefSchema,
    WorkspaceBranding: S.WorkspaceBrandingSchema,
    CustomDomain: S.CustomDomainSchema,
    FirebaseClientOptions: S.FirebaseClientOptionsSchema,
    AndroidRelease: S.AndroidReleaseSchema,
    Device: S.DeviceSchema,
    Presence: S.PresenceSchema,
    AttendanceSession: S.AttendanceSessionSchema,
    FloorRequest: S.FloorRequestSchema,
    SeatMap: S.SeatMapSchema,
    FloorAsset: S.FloorAssetSchema,
    Company: S.CompanySchema,
    // change #19 wave C: hub
    IntegrationProviderInfo: S.IntegrationProviderInfoSchema,
    WebhookAttempt: S.WebhookAttemptSchema,
    PayloadMapping: S.PayloadMappingSchema,
  };
  const componentJson = Object.fromEntries(Object.entries(components).map(([name, schema]) => [name, inlineJsonOf(schema)]));

  for (const [id, def] of Object.entries(API_ROUTES) as Array<[string, RouteDef]>) {
    if (opts.include && !opts.include(id, def)) continue;
    const path = def.absolute ? def.path : `${API_BASE_PATH}${def.path}`;
    const security: Array<Record<string, string[]>> =
      opts.publicApi && (def.auth === 'api_key' || def.auth === 'jwt_or_api_key')
        ? [{ apiKey: [] }]
        : def.auth === 'jwt'
        ? [{ bearerJwt: [] }]
        : def.auth === 'api_key'
          ? [{ apiKey: [] }]
          : def.auth === 'jwt_or_api_key'
            ? [{ bearerJwt: [] }, { apiKey: [] }]
            : def.auth === 'webhook'
              ? [{ webhookSignature: [] }]
              : def.auth === 'super'
                ? [{ bearerPlatform: [] }]
                : [];

    const status = String(def.status ?? 200);
    const okContent = def.response
      ? { 'application/json': { schema: def.response } }
      : def.responseContentType
        ? { [def.responseContentType]: { schema: z.string() } }
        : undefined;

    registry.registerPath({
      operationId: id,
      method: def.method,
      path,
      summary: def.summary,
      description: (opts.publicApi
        ? [def.permission ? `Requires the API key scope \`${def.permission}\`.` : null, def.auth === 'webhook' ? 'Signed with the source secret (see webhookSignature).' : null]
        : [def.permission ? `Requires permission \`${def.permission}\`.` : null, `Owner: ${def.owner}. Phase ${def.phase}.`]
      )
        .filter(Boolean)
        .join(' '),
      tags: [def.tag],
      security,
      request: {
        ...(def.params ? { params: def.params } : {}),
        ...(def.query && def.query instanceof z.ZodObject ? { query: def.query } : {}),
        ...(def.body
          ? { body: { required: true, content: { 'application/json': { schema: def.body } } } }
          : def.bodyContentType
            ? {
                body: {
                  required: true,
                  content: {
                    [def.bodyContentType]: {
                      schema: (def.bodyFields ?? z.object({})).extend({ file: z.string().describe('binary') }),
                    },
                  },
                },
              }
            : {}),
      },
      responses: {
        [status]: { description: 'OK', ...(okContent ? { content: okContent } : {}) },
        '4XX': errorResponse,
        '5XX': errorResponse,
      },
    });
  }

  const generator = new OpenApiGeneratorV31(registry.definitions);
  const doc = generator.generateDocument({
    openapi: '3.1.0',
    info: opts.publicApi
      ? {
          title: 'Vistar public API',
          version: opts.version ?? '0.1.0',
          description:
            'REST API for your workspace. Authenticate with an API key (Authorization: Bearer vst_live_...); each key has scopes and a per-minute rate limit (429 with Retry-After). All data is scoped to the key\'s workspace. Errors use the ApiError envelope with stable codes.',
        }
      : {
          title: 'Vistar API',
          version: opts.version ?? '0.1.0',
          description:
            'Multi-tenant sales management API. All data is scoped to the caller workspace. Errors use the ApiError envelope with stable codes.',
        },
    servers: [{ url: opts.serverUrl ?? 'http://localhost:4000' }],
  });
  const deduped = dedupeComponents(doc, componentJson);
  return opts.publicApi ? pruneComponents(deduped) : deduped;
}

/** Drop component schemas (and security schemes) that no path references, directly or through other components. */
function pruneComponents(doc: OpenApiDocument): OpenApiDocument {
  const schemas = (doc.components?.schemas ?? {}) as Record<string, unknown>;
  const used = new Set<string>();
  const usedSecurity = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string' && v.startsWith('#/components/schemas/')) {
        const name = v.slice('#/components/schemas/'.length);
        if (!used.has(name)) {
          used.add(name);
          visit(schemas[name]);
        }
      } else if (k === 'security' && Array.isArray(v)) {
        for (const req of v) for (const scheme of Object.keys(req as object)) usedSecurity.add(scheme);
        visit(v);
      } else visit(v);
    }
  };
  visit(doc.paths);
  const securitySchemes = Object.fromEntries(Object.entries(doc.components?.securitySchemes ?? {}).filter(([name]) => usedSecurity.has(name)));
  return {
    ...doc,
    components: {
      ...doc.components,
      schemas: Object.fromEntries(Object.entries(schemas).filter(([name]) => used.has(name))) as never,
      securitySchemes: securitySchemes as never,
    },
  };
}

/** Exact JSON the generator produces for a schema when inlined (used as the component body). */
function inlineJsonOf(schema: z.ZodType): unknown {
  const r = new OpenAPIRegistry();
  r.registerPath({
    method: 'get',
    path: '/x',
    responses: { 200: { description: 'x', content: { 'application/json': { schema } } } },
  });
  const d = new OpenApiGeneratorV31(r.definitions).generateDocument({ openapi: '3.1.0', info: { title: 'x', version: '0' } });
  const op = d.paths?.['/x']?.get as { responses: Record<string, { content: Record<string, { schema: unknown }> }> };
  return op.responses['200']?.content['application/json']?.schema;
}

/**
 * Paths reference schema instances directly, so the generator inlines them. Replace any inline
 * object identical to a component with a $ref and publish the components.
 */
function dedupeComponents(doc: OpenApiDocument, schemas: Record<string, unknown>): OpenApiDocument {
  const byJson = new Map<string, string>();
  for (const [name, schema] of Object.entries(schemas)) byJson.set(JSON.stringify(schema), name);

  const walk = (node: unknown, self: string | null, depth: number): unknown => {
    if (Array.isArray(node)) return node.map((n) => walk(n, self, depth + 1));
    if (!node || typeof node !== 'object') return node;
    const match = byJson.get(JSON.stringify(node));
    if (match && !(match === self && depth === 0)) return { $ref: `#/components/schemas/${match}` };
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, self, depth + 1)]));
  };

  const paths = walk(doc.paths, null, 1) as OpenApiDocument['paths'];
  const dedupedSchemas = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, walk(schema, name, 0)]));
  return { ...doc, paths, components: { ...doc.components, schemas: dedupedSchemas as never } };
}
