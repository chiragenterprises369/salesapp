/**
 * Reading the public OpenAPI 3.1 document (`GET /api/v1/openapi.json`) for Settings > API docs.
 * Plain helpers, no React: list and group operations, resolve `$ref`s, describe JSON Schema types,
 * build example bodies and a curl command. Unknown shapes are tolerated (the page never crashes on
 * a document from a newer API).
 */

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
export const HTTP_METHODS: readonly HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];

export interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  description?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  example?: unknown;
  examples?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  nullable?: boolean;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
}

export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
}

interface MediaType {
  schema?: JsonSchema;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  security?: Array<Record<string, string[]>>;
  parameters?: OpenApiParameter[];
  requestBody?: { required?: boolean; content?: Record<string, MediaType> };
  responses?: Record<string, { description?: string; content?: Record<string, MediaType> }>;
  deprecated?: boolean;
}

export interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: Array<{ url: string; description?: string }>;
  paths?: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>;
  components?: { schemas?: Record<string, JsonSchema>; securitySchemes?: Record<string, { type?: string; scheme?: string; description?: string; name?: string; in?: string }> };
  tags?: Array<{ name: string; description?: string }>;
}

export interface ApiOperation {
  /** Stable id for links (`operationId`, else method + path). */
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description: string;
  tag: string;
  permission: string | null;
  security: string[];
  parameters: OpenApiParameter[];
  requestBody: { required: boolean; contentType: string; schema: JsonSchema | null } | null;
  responses: Array<{ status: string; description: string; contentType: string | null; schema: JsonSchema | null }>;
  deprecated: boolean;
}

export interface ApiTagGroup {
  tag: string;
  label: string;
  description: string | null;
  operations: ApiOperation[];
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** True when the value looks like an OpenAPI document with paths. */
export function isOpenApiDocument(v: unknown): v is OpenApiDocument {
  return isObject(v) && isObject(v.paths);
}

/** "Requires permission `leads.read`." in the generated description -> "leads.read". */
export function permissionFrom(description: string | undefined): string | null {
  const m = description ? /permission `([^`]+)`/.exec(description) : null;
  return m?.[1] ?? null;
}

/** Description without the generator's bookkeeping sentences (permission, owner, phase). */
export function cleanDescription(description: string | undefined): string {
  if (!description) return '';
  return description
    .replace(/Requires permission `[^`]+`\.\s*/g, '')
    .replace(/Owner: [^.]+\.\s*/g, '')
    .replace(/Phase \d+\.\s*/g, '')
    .trim();
}

/** "api-keys" -> "API keys", "team-floor" -> "Team floor". */
export function tagLabel(tag: string): string {
  const words = tag.replace(/[-_]+/g, ' ').trim();
  if (!words) return 'Other';
  const fixed = words.replace(/\bapi\b/gi, 'API').replace(/\bcrm\b/gi, 'CRM').replace(/\bgst\b/gi, 'GST');
  return fixed.charAt(0).toUpperCase() + fixed.slice(1);
}

function firstContent(content: Record<string, MediaType> | undefined): { contentType: string; schema: JsonSchema | null } | null {
  if (!content) return null;
  const entries = Object.entries(content);
  if (!entries.length) return null;
  const json = entries.find(([t]) => t.includes('json')) ?? entries[0]!;
  return { contentType: json[0], schema: json[1]?.schema ?? null };
}

/** Every operation of the document, in path order. */
export function listOperations(doc: OpenApiDocument): ApiOperation[] {
  const out: ApiOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    if (!item || typeof item !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const op: OpenApiOperation | undefined = item[method];
      if (!op || typeof op !== 'object' || Array.isArray(op)) continue;
      const body = op.requestBody ? firstContent(op.requestBody.content) : null;
      out.push({
        id: op.operationId ?? `${method}-${path}`,
        method,
        path,
        summary: op.summary ?? '',
        description: cleanDescription(op.description),
        tag: op.tags?.[0] ?? 'other',
        permission: permissionFrom(op.description),
        security: (op.security ?? []).flatMap((s) => Object.keys(s)),
        parameters: Array.isArray(op.parameters) ? op.parameters.filter((p) => isObject(p) && typeof p.name === 'string') : [],
        requestBody: body ? { required: !!op.requestBody?.required, contentType: body.contentType, schema: body.schema } : null,
        responses: Object.entries(op.responses ?? {}).map(([status, r]) => {
          const c = firstContent(r?.content);
          return { status, description: r?.description ?? '', contentType: c?.contentType ?? null, schema: c?.schema ?? null };
        }),
        deprecated: !!op.deprecated,
      });
    }
  }
  return out;
}

/** Operations grouped by their first tag; groups sorted by label, operations by path then method. */
export function groupByTag(doc: OpenApiDocument, ops: readonly ApiOperation[]): ApiTagGroup[] {
  const descriptions = new Map((doc.tags ?? []).map((t) => [t.name, t.description ?? null]));
  const groups = new Map<string, ApiOperation[]>();
  for (const op of ops) groups.set(op.tag, [...(groups.get(op.tag) ?? []), op]);
  return [...groups.entries()]
    .map(([tag, list]) => ({
      tag,
      label: tagLabel(tag),
      description: descriptions.get(tag) ?? null,
      operations: [...list].sort((a, b) => a.path.localeCompare(b.path) || HTTP_METHODS.indexOf(a.method) - HTTP_METHODS.indexOf(b.method)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Case-insensitive search over path, summary, tag, operation id and permission. Every word must match. */
export function searchOperations(ops: readonly ApiOperation[], query: string): ApiOperation[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...ops];
  return ops.filter((op) => {
    const hay = `${op.method} ${op.path} ${op.summary} ${op.tag} ${tagLabel(op.tag)} ${op.id} ${op.permission ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Name of a local component ref ("#/components/schemas/Lead" -> "Lead"). */
export function refName(ref: string): string {
  return ref.split('/').pop() ?? ref;
}

/** Follow a local `$ref` (only `#/components/schemas/...`). Unknown refs resolve to an empty schema. */
export function deref(doc: OpenApiDocument, schema: JsonSchema | null | undefined): JsonSchema {
  let s: JsonSchema = schema ?? {};
  for (let i = 0; i < 10 && s.$ref; i++) {
    const name = s.$ref.startsWith('#/components/schemas/') ? refName(s.$ref) : null;
    const next = name ? doc.components?.schemas?.[name] : undefined;
    if (!next) return { description: s.description };
    s = { ...next, description: s.description ?? next.description };
  }
  return s;
}

/** Types of a schema without "null" (3.1 uses `type: ["string", "null"]`; anyOf with a null branch too). */
export function nonNullBranches(schema: JsonSchema): { branches: JsonSchema[]; nullable: boolean } {
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants) {
    const isNull = (v: JsonSchema) => v.type === 'null' || (Array.isArray(v.type) && v.type.length === 1 && v.type[0] === 'null');
    return { branches: variants.filter((v) => !isNull(v)), nullable: variants.some(isNull) || !!schema.nullable };
  }
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((t) => t !== 'null');
    return { branches: [{ ...schema, type: types.length === 1 ? types[0] : types }], nullable: schema.type.includes('null') || !!schema.nullable };
  }
  return { branches: [schema], nullable: !!schema.nullable };
}

/** Short type label: "string (email)", "array of Lead", "Lead", "one of: ...", "enum". */
export function typeLabel(doc: OpenApiDocument, schema: JsonSchema | null | undefined, depth = 0): string {
  if (!schema) return 'any';
  if (schema.$ref) return refName(schema.$ref);
  const { branches, nullable } = nonNullBranches(schema);
  const suffix = nullable ? ' or null' : '';
  if (branches.length > 1) return depth > 1 ? 'one of several types' + suffix : branches.map((b) => typeLabel(doc, b, depth + 1)).join(' or ') + suffix;
  const s = branches[0] ?? {};
  if (s.$ref) return refName(s.$ref) + suffix;
  if (s.allOf?.length) return (s.allOf.length === 1 ? typeLabel(doc, s.allOf[0], depth + 1) : 'object') + suffix;
  if (s.const !== undefined) return `${JSON.stringify(s.const)}${suffix}`;
  if (s.enum) return `enum${suffix}`;
  const t = Array.isArray(s.type) ? s.type.join(' or ') : s.type;
  if (t === 'array') return `array of ${typeLabel(doc, s.items, depth + 1)}${suffix}`;
  if (t === 'object' || (!t && s.properties)) return `object${suffix}`;
  if (t === 'string' && s.format) return `string (${s.format})${suffix}`;
  if (t === 'integer') return `integer${suffix}`;
  return (t ?? 'any') + suffix;
}

/** Readable limits: "1 to 80 characters", "at least 1", "matches ^[a-z]+$". */
export function constraintsOf(schema: JsonSchema): string[] {
  const out: string[] = [];
  if (schema.minLength !== undefined && schema.maxLength !== undefined) out.push(`${schema.minLength} to ${schema.maxLength} characters`);
  else if (schema.maxLength !== undefined) out.push(`up to ${schema.maxLength} characters`);
  else if (schema.minLength !== undefined && schema.minLength > 0) out.push(`at least ${schema.minLength} characters`);
  const min = schema.minimum ?? schema.exclusiveMinimum;
  const max = schema.maximum ?? schema.exclusiveMaximum;
  if (min !== undefined && max !== undefined && Math.abs(max) < 1e15) out.push(`${min} to ${max}`);
  else if (min !== undefined) out.push(`at least ${min}`);
  else if (max !== undefined && Math.abs(max) < 1e15) out.push(`at most ${max}`);
  if (schema.minItems !== undefined && schema.minItems > 0) out.push(`at least ${schema.minItems} ${schema.minItems === 1 ? 'item' : 'items'}`);
  if (schema.maxItems !== undefined) out.push(`at most ${schema.maxItems} items`);
  if (schema.pattern) out.push(`matches ${schema.pattern}`);
  if (schema.default !== undefined) out.push(`default ${JSON.stringify(schema.default)}`);
  return out;
}

const FORMAT_EXAMPLES: Record<string, string> = {
  uuid: '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b',
  email: 'priya@example.in',
  'date-time': '2026-11-03T10:30:00.000Z',
  date: '2026-11-03',
  uri: 'https://example.in/hooks/vistar',
  url: 'https://example.in/hooks/vistar',
};

/** Example value for a schema (for request bodies in the curl example). Depth-limited, no cycles. */
export function exampleFor(doc: OpenApiDocument, schema: JsonSchema | null | undefined, depth = 0, seen: ReadonlySet<string> = new Set()): unknown {
  if (!schema || depth > 6) return null;
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return {};
    return exampleFor(doc, deref(doc, schema), depth, new Set([...seen, schema.$ref]));
  }
  if (schema.example !== undefined) return schema.example;
  if (schema.examples?.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  const { branches } = nonNullBranches(schema);
  const s = branches[0] ?? {};
  if (s !== schema) return exampleFor(doc, s, depth + 1, seen);
  if (s.allOf?.length) return Object.assign({}, ...s.allOf.map((a) => exampleFor(doc, a, depth + 1, seen) as object));
  const t = Array.isArray(s.type) ? s.type[0] : s.type;
  if (t === 'object' || (!t && s.properties)) {
    const props = Object.entries(s.properties ?? {});
    const required = new Set(s.required ?? []);
    // Required fields first; optional ones only for small objects so the example stays readable.
    const pick = props.filter(([k]) => required.has(k) || props.length <= 6);
    return Object.fromEntries(pick.map(([k, v]) => [k, exampleFor(doc, v, depth + 1, seen)]));
  }
  if (t === 'array') return s.items ? [exampleFor(doc, s.items, depth + 1, seen)] : [];
  if (t === 'string') return (s.format && FORMAT_EXAMPLES[s.format]) || (s.minLength && s.minLength > 6 ? 'x'.repeat(s.minLength) : 'string');
  if (t === 'integer') return s.minimum !== undefined && s.minimum > 0 ? s.minimum : 1;
  if (t === 'number') return s.minimum !== undefined && s.minimum > 0 ? s.minimum : 1.5;
  if (t === 'boolean') return true;
  return null;
}

/** Quote a value for a POSIX shell (single quotes; embedded quotes closed and escaped). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * curl for an operation against `baseUrl` (the API origin, e.g. https://api.vistar.in): path
 * parameters as `<name>` placeholders, required query parameters with example values, a JSON body
 * from the request schema. The key comes from $VISTAR_API_KEY so it is never pasted into history.
 */
export function curlFor(doc: OpenApiDocument, op: ApiOperation, baseUrl: string): string {
  const path = op.path.replace(/\{([^}]+)\}/g, (_m, name: string) => `<${name}>`);
  const query = op.parameters
    .filter((p) => p.in === 'query' && p.required)
    .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(String(exampleFor(doc, p.schema) ?? ''))}`)
    .join('&');
  const url = `${baseUrl.replace(/\/+$/, '')}${path}${query ? `?${query}` : ''}`;
  const lines = [`curl -X ${op.method.toUpperCase()} ${shellQuote(url)}`];
  const auth = op.security.some((s) => s === 'apiKey' || s === 'bearerJwt');
  if (auth) lines.push(`  -H "Authorization: Bearer $VISTAR_API_KEY"`);
  if (op.requestBody && op.requestBody.contentType.includes('json')) {
    lines.push(`  -H 'Content-Type: application/json'`);
    lines.push(`  -d ${shellQuote(JSON.stringify(exampleFor(doc, op.requestBody.schema), null, 2))}`);
  } else if (op.requestBody?.contentType.startsWith('multipart/')) {
    lines.push(`  -F 'file=@./file.csv'`);
  }
  return lines.join(' \\\n');
}

/** Human label of a security scheme name used in the document. */
export function securityLabel(doc: OpenApiDocument, name: string): string {
  const known: Record<string, string> = {
    apiKey: 'API key (Bearer vst_live_...)',
    bearerJwt: 'Signed-in user (Bearer access token)',
    webhookSignature: 'Webhook signature (X-Vistar-Signature)',
    bearerPlatform: 'Super Admin token',
  };
  return known[name] ?? doc.components?.securitySchemes?.[name]?.description ?? name;
}
