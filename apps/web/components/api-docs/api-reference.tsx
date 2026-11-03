'use client';

import type { ChipTone } from '@vistar/shared';
import { BookOpen, KeyRound, Lock, Search, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';
import { useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { InlineAlert, LoadError } from '@/components/settings/common/states';
import { SettingsCard } from '@/components/settings/settings-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { isMockData } from '@/lib/api/data-source';
import { cn } from '@/lib/cn';
import { apiBaseUrl, useApiReference } from '@/lib/hub/docs';
import { curlFor, groupByTag, listOperations, searchOperations, securityLabel, type ApiOperation, type OpenApiDocument } from '@/lib/hub/openapi';
import { CodeBlock, CopyField } from '@/lib/hub/ui/copy';
import { useCan } from '@/lib/session/session';
import { SchemaView } from './schema-view';

export const METHOD_TONE: Record<string, ChipTone> = { get: 'blue', post: 'green', put: 'amber', patch: 'amber', delete: 'red' };

export function MethodChip({ method, className }: { method: string; className?: string }) {
  return (
    <Chip tone={METHOD_TONE[method] ?? 'neutral'} className={cn('w-12 justify-center font-mono uppercase', className)}>
      {method}
    </Chip>
  );
}

const opAnchor = (id: string) => `op-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;

/** Location hash as an external store (deep links `#op-...`, back and forward). */
const HASH_EVENT = 'vistar:hash';
function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  window.addEventListener(HASH_EVENT, onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener(HASH_EVENT, onChange);
  };
}
const readHash = () => decodeURIComponent(window.location.hash.replace(/^#/, ''));
function setHash(anchor: string) {
  window.history.replaceState(null, '', `#${anchor}`);
  window.dispatchEvent(new Event(HASH_EVENT));
}

/**
 * Settings > API docs: the public REST reference rendered from the API's own OpenAPI document,
 * grouped by tag, with search, an endpoint detail (parameters, request and response schemas, auth,
 * scope) and a curl example against the workspace's API address. Deep links: `#op-<operationId>`.
 */
export function ApiReference() {
  const q = useApiReference();
  if (isMockData())
    return (
      <InlineAlert tone="info" title="The API reference needs the Vistar API">
        This build runs on sample data for automated tests, so there is no API to describe. Open it on a build connected to the API.
      </InlineAlert>
    );
  if (q.isPending) return <ReferenceSkeleton />;
  if (q.isError) return <LoadError title="The API reference did not load" onRetry={() => void q.refetch()} />;
  return <Reference doc={q.data} />;
}

function ReferenceSkeleton() {
  return (
    <div role="status" aria-label="Loading the API reference" className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-full" />
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </div>
  );
}

function Reference({ doc }: { doc: OpenApiDocument }) {
  const canKeys = useCan('apikeys.manage');
  const all = useMemo(() => listOperations(doc), [doc]);
  const [query, setQuery] = useState('');
  const found = useMemo(() => searchOperations(all, query), [all, query]);
  const groups = useMemo(() => groupByTag(doc, found), [doc, found]);
  const hash = useSyncExternalStore(subscribeHash, readHash, () => '');
  const baseUrl = apiBaseUrl(doc);
  const detailRef = useRef<HTMLDivElement>(null);
  const searchId = useId();

  const current = all.find((o) => opAnchor(o.id) === hash) ?? all[0] ?? null;
  const selected = current?.id ?? null;
  const open = (op: ApiOperation) => {
    setHash(opAnchor(op.id));
    // On narrow screens the detail sits below the list: bring it into view and move focus to it.
    requestAnimationFrame(() => {
      const el = detailRef.current;
      if (!el) return;
      if (window.matchMedia('(max-width: 1023px)').matches) el.scrollIntoView({ block: 'start' });
      el.focus({ preventScroll: true });
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <SettingsCard
        title={`${doc.info?.title ?? 'Vistar API'}${doc.info?.version ? ` ${doc.info.version}` : ''}`}
        description="Every request is scoped to your workspace. Send an API key as a Bearer token; each key only reaches the resources its scopes allow."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <CopyField label="API address" value={baseUrl} what="API address" testId="api-base-url" />
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-fg-secondary">Authentication</p>
            <p className="font-mono text-xs text-fg">Authorization: Bearer vst_live_…</p>
            <p className="text-xs text-muted">
              Errors use one JSON shape: <code className="font-mono">{'{ "error": { "code", "message", "details", "requestId" } }'}</code>. Too many requests answer 429.
            </p>
          </div>
        </div>
        {canKeys && (
          <div className="mt-3">
            <Button size="sm" asChild>
              <Link href="/app/settings/api-keys">
                <KeyRound aria-hidden />
                Manage API keys
              </Link>
            </Button>
          </div>
        )}
      </SettingsCard>

      <div className="grid items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Card className="flex min-w-0 flex-col lg:sticky lg:top-4 lg:max-h-[calc(100dvh-8rem)]">
          <div className="border-b border-border p-3">
            <label htmlFor={searchId} className="sr-only">
              Search endpoints
            </label>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search, e.g. leads create"
                className="h-8 w-full rounded-md border border-input bg-surface pr-8 pl-8 text-sm text-fg shadow-card placeholder:text-muted focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
              />
              {query && (
                <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="focus-ring absolute top-1/2 right-1.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted hover:text-fg">
                  <X aria-hidden className="size-3.5" />
                </button>
              )}
            </div>
            <p className="mt-1.5 text-2xs text-muted-strong" aria-live="polite">
              {found.length} of {all.length} endpoints
            </p>
          </div>
          <nav aria-label="Endpoints" className="min-h-0 flex-1 overflow-y-auto p-2">
            {groups.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-strong">No endpoint matches “{query}”.</p>
            ) : (
              groups.map((g) => (
                <section key={g.tag} aria-labelledby={`tag-${g.tag}`} className="mb-3 last:mb-0">
                  <h3 id={`tag-${g.tag}`} className="px-2 pb-1 text-xs font-semibold text-fg-secondary">
                    {g.label}
                  </h3>
                  <ul className="flex flex-col gap-0.5">
                    {g.operations.map((op) => (
                      <li key={op.id}>
                        <a
                          href={`#${opAnchor(op.id)}`}
                          aria-current={op.id === selected ? 'true' : undefined}
                          data-slot="subnav-item"
                          data-op={op.id}
                          onClick={(e) => {
                            e.preventDefault();
                            open(op);
                          }}
                          className="focus-ring flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-3 aria-[current=true]:bg-accent-soft aria-[current=true]:text-accent-soft-fg"
                        >
                          <MethodChip method={op.method} className="mt-px" />
                          <span className="min-w-0">
                            <span className="block truncate font-mono text-2xs text-fg">{op.path}</span>
                            {op.summary && <span className="block truncate text-2xs text-muted-strong">{op.summary}</span>}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </nav>
        </Card>

        <div ref={detailRef} tabIndex={-1} className="min-w-0 outline-none" aria-label={current ? `${current.method.toUpperCase()} ${current.path}` : 'Endpoint detail'} role="region">
          {current ? (
            <OperationDetail doc={doc} op={current} baseUrl={baseUrl} />
          ) : (
            <EmptyState icon={<BookOpen />} title="Pick an endpoint" description="Choose one on the left to see its parameters, request and response, and a curl example." />
          )}
        </div>
      </div>
    </div>
  );
}

function OperationDetail({ doc, op, baseUrl }: { doc: OpenApiDocument; op: ApiOperation; baseUrl: string }) {
  const params = op.parameters;
  const ok = op.responses.filter((r) => /^2/.test(r.status));
  const errors = op.responses.filter((r) => !/^2/.test(r.status));
  const keyOk = op.security.includes('apiKey');
  return (
    <Card className="flex min-w-0 flex-col gap-5 p-4 sm:p-5" data-testid="api-operation">
      <header className="flex flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <MethodChip method={op.method} />
          <code className="min-w-0 font-mono text-sm break-all text-fg">{op.path}</code>
          {op.deprecated && <Chip tone="amber">Deprecated</Chip>}
        </div>
        <h2 className="text-base font-semibold text-fg">{op.summary || op.id}</h2>
        {op.description && <p className="text-sm text-fg-secondary">{op.description}</p>}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {op.security.length === 0 ? (
            <Chip tone="grey">
              <Lock aria-hidden />
              No sign-in
            </Chip>
          ) : (
            op.security.map((s) => (
              <Chip key={s} tone={s === 'apiKey' ? 'indigo' : 'neutral'}>
                <Lock aria-hidden />
                {securityLabel(doc, s)}
              </Chip>
            ))
          )}
          {op.permission && (
            <Chip tone="neutral">
              <ShieldCheck aria-hidden />
              {keyOk ? 'Scope' : 'Permission'} <code className="font-mono">{op.permission}</code>
            </Chip>
          )}
        </div>
      </header>

      {params.length > 0 && (
        <section aria-labelledby={`${opAnchor(op.id)}-params`}>
          <h3 id={`${opAnchor(op.id)}-params`} className="mb-1.5 text-sm font-semibold text-fg">
            Parameters
          </h3>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {params.map((p) => (
              <li key={`${p.in}-${p.name}`} className="flex flex-col gap-0.5 px-3 py-2">
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <code className="font-mono text-xs font-semibold text-fg">{p.name}</code>
                  <span className="text-2xs text-muted-strong">{p.in}</span>
                  <span className="font-mono text-2xs text-muted-strong">{p.schema ? (p.schema.enum ? 'enum' : String(p.schema.type ?? (p.schema.$ref ? 'object' : 'string'))) : 'string'}</span>
                  {p.required && <Chip tone="amber">required</Chip>}
                </span>
                {(p.description ?? p.schema?.description) && <span className="text-xs text-fg-secondary">{p.description ?? p.schema?.description}</span>}
                {p.schema?.enum && <span className="font-mono text-2xs text-muted-strong">{p.schema.enum.map((v) => JSON.stringify(v)).join(' | ')}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {op.requestBody && (
        <section aria-labelledby={`${opAnchor(op.id)}-body`}>
          <h3 id={`${opAnchor(op.id)}-body`} className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-fg">
            Request body
            <span className="font-mono text-2xs font-normal text-muted-strong">{op.requestBody.contentType}</span>
          </h3>
          <SchemaView doc={doc} schema={op.requestBody.schema} />
        </section>
      )}

      <section aria-labelledby={`${opAnchor(op.id)}-res`}>
        <h3 id={`${opAnchor(op.id)}-res`} className="mb-1.5 text-sm font-semibold text-fg">
          Response
        </h3>
        {ok.length === 0 ? (
          <p className="text-xs text-muted-strong">No response body.</p>
        ) : (
          ok.map((r) => (
            <div key={r.status} className="mb-3 last:mb-0">
              <p className="mb-1 flex items-center gap-2 text-xs">
                <Chip tone="green">{r.status}</Chip>
                <span className="text-fg-secondary">{r.description}</span>
              </p>
              {r.schema ? <SchemaView doc={doc} schema={r.schema} /> : <p className="text-xs text-muted-strong">{r.status === '204' ? 'No content.' : 'Empty body.'}</p>}
            </div>
          ))
        )}
        {errors.length > 0 && (
          <p className="mt-2 text-xs text-muted-strong">
            Errors ({errors.map((e) => e.status).join(', ')}) return the error envelope with a stable <code className="font-mono">code</code> and a readable <code className="font-mono">message</code>.
          </p>
        )}
      </section>

      <CodeBlock title="Example" language="curl" code={curlFor(doc, op, baseUrl)} what="Example command" />
    </Card>
  );
}
