'use client';

import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Chip } from '@/components/ui/chip';
import { constraintsOf, deref, nonNullBranches, refName, typeLabel, type JsonSchema, type OpenApiDocument } from '@/lib/hub/openapi';

const MAX_DEPTH = 5;

/** The object behind a schema (following refs, arrays of objects and single-branch unions), or null. */
function objectOf(doc: OpenApiDocument, schema: JsonSchema | undefined, seen: ReadonlySet<string>): { schema: JsonSchema; seen: ReadonlySet<string> } | null {
  if (!schema) return null;
  let s = schema;
  let refs = seen;
  for (let i = 0; i < 6; i++) {
    if (s.$ref) {
      if (refs.has(s.$ref)) return null;
      refs = new Set([...refs, s.$ref]);
      s = deref(doc, s);
      continue;
    }
    const { branches } = nonNullBranches(s);
    if (branches.length === 1 && branches[0] !== s) {
      s = branches[0]!;
      continue;
    }
    if (s.allOf?.length === 1) {
      s = s.allOf[0]!;
      continue;
    }
    const t = Array.isArray(s.type) ? s.type[0] : s.type;
    if (t === 'array' && s.items) {
      s = s.items;
      continue;
    }
    break;
  }
  const hasProps = s.properties && Object.keys(s.properties).length > 0;
  return hasProps ? { schema: s, seen: refs } : null;
}

function EnumValues({ values }: { values: unknown[] }) {
  const shown = values.slice(0, 24);
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1 text-2xs text-muted-strong">
      <span>One of:</span>
      {shown.map((v) => (
        <code key={JSON.stringify(v)} className="rounded-sm bg-surface-3 px-1 py-px font-mono text-fg-secondary">
          {JSON.stringify(v)}
        </code>
      ))}
      {values.length > shown.length && <span>and {values.length - shown.length} more</span>}
    </p>
  );
}

function enumOf(doc: OpenApiDocument, schema: JsonSchema): unknown[] | null {
  const s = deref(doc, schema);
  const { branches } = nonNullBranches(s);
  const b = branches.length === 1 ? deref(doc, branches[0]) : s;
  if (b.enum?.length) return b.enum;
  const t = Array.isArray(b.type) ? b.type[0] : b.type;
  if (t === 'array' && b.items) {
    const items = deref(doc, b.items);
    if (items.enum?.length) return items.enum;
  }
  return null;
}

/** One property row: name, type, required, description, limits, enum values and nested fields. */
function PropertyRow({ doc, name, schema, required, depth, seen }: { doc: OpenApiDocument; name: string; schema: JsonSchema; required: boolean; depth: number; seen: ReadonlySet<string> }) {
  const resolved = deref(doc, schema);
  const description = schema.description ?? resolved.description;
  const limits = constraintsOf(nonNullBranches(resolved).branches[0] ?? resolved);
  const values = enumOf(doc, schema);
  const nested = depth < MAX_DEPTH ? objectOf(doc, schema, seen) : null;
  const head: ReactNode = (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <code className="font-mono text-xs font-semibold text-fg">{name}</code>
      <span className="font-mono text-2xs text-muted-strong">{typeLabel(doc, schema)}</span>
      {required && (
        <Chip tone="amber" className="self-center">
          required
        </Chip>
      )}
    </span>
  );
  const body = (
    <>
      {description && <p className="mt-0.5 text-xs text-fg-secondary">{description}</p>}
      {limits.length > 0 && <p className="mt-0.5 text-2xs text-muted-strong">{limits.join(' · ')}</p>}
      {values && <EnumValues values={values} />}
    </>
  );
  if (!nested)
    return (
      <li className="py-2">
        {head}
        {body}
      </li>
    );
  return (
    <li className="py-2">
      <details className="group">
        <summary className="focus-ring -mx-1 flex cursor-pointer list-none items-start gap-1 rounded-sm px-1 [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-strong transition-transform duration-150 group-open:rotate-90" />
          <span className="min-w-0">
            {head}
            <span className="sr-only"> (show fields)</span>
          </span>
        </summary>
        <div className="pl-4">
          {body}
          <PropertyList doc={doc} schema={nested.schema} depth={depth + 1} seen={nested.seen} />
        </div>
      </details>
    </li>
  );
}

function PropertyList({ doc, schema, depth, seen }: { doc: OpenApiDocument; schema: JsonSchema; depth: number; seen: ReadonlySet<string> }) {
  const required = new Set(schema.required ?? []);
  const props = Object.entries(schema.properties ?? {}).sort(([a], [b]) => Number(required.has(b)) - Number(required.has(a)));
  return (
    <ul className="mt-1 flex flex-col divide-y divide-border border-l border-border pl-3">
      {props.map(([name, s]) => (
        <PropertyRow key={name} doc={doc} name={name} schema={s} required={required.has(name)} depth={depth} seen={seen} />
      ))}
    </ul>
  );
}

/**
 * JSON Schema as a readable field list. Objects list their properties (required first), arrays show
 * their item fields, nested objects open with a native disclosure (keyboard and screen reader friendly).
 */
export function SchemaView({ doc, schema }: { doc: OpenApiDocument; schema: JsonSchema | null }) {
  if (!schema) return <p className="text-xs text-muted-strong">No body.</p>;
  const label = typeLabel(doc, schema);
  const obj = objectOf(doc, schema, new Set());
  const top = deref(doc, schema);
  return (
    <div className="min-w-0">
      <p className="text-xs text-fg-secondary">
        <span className="font-mono text-2xs text-muted-strong">{label}</span>
        {schema.$ref && <span className="ml-2 text-2xs text-muted-strong">schema {refName(schema.$ref)}</span>}
      </p>
      {top.description && <p className="mt-0.5 text-xs text-fg-secondary">{top.description}</p>}
      {obj ? <PropertyList doc={doc} schema={obj.schema} depth={1} seen={obj.seen} /> : enumOf(doc, schema) ? <EnumValues values={enumOf(doc, schema)!} /> : null}
    </div>
  );
}
