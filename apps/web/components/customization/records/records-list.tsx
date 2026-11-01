'use client';

import { keepPreviousData, useQueries } from '@tanstack/react-query';
import {
  objectRecordsHref,
  type CustomObject,
  type CustomRecord,
  type CustomRecordListQuery,
} from '@vistar/shared';
import { ArrowDownUp, Plus, Search, UserRound, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { timeAgo } from '@/components/leads/lead-meta';
import { Select } from '@/components/leads/primitives/select';
import { EmptyState, ErrorState } from '@/components/leads/states';
import { getCustomizationSource, recordKeys, useCustomObject } from '@/lib/customization';
import { useCan, useMe } from '@/lib/session/session';
import { cn } from '@/lib/cn';
import { CustomFieldDisplay } from '../custom-field-display';
import type { FieldDef } from '../field-utils';
import { RecordCreateSheet } from './record-create-sheet';
import { isNotFound, ObjectIcon, useDebounced, useObjectFields, USER_BY_ID } from './record-meta';
import { RecordsListSkeleton, RecordsNotFound } from './record-states';

type OwnerFilter = 'all' | 'me' | 'unassigned';
type SortKey = 'newest' | 'oldest' | 'updated' | 'title';
const SORTS: Record<
  SortKey,
  { label: string; sort: CustomRecordListQuery['sort']; dir: CustomRecordListQuery['dir'] }
> = {
  newest: { label: 'Newest first', sort: 'createdAt', dir: 'desc' },
  oldest: { label: 'Oldest first', sort: 'createdAt', dir: 'asc' },
  updated: { label: 'Recently updated', sort: 'updatedAt', dir: 'desc' },
  title: { label: 'Name A to Z', sort: 'title', dir: 'asc' },
};
const OWNER_LABEL: Record<OwnerFilter, string> = {
  all: 'All owners',
  me: 'Mine',
  unassigned: 'Unassigned',
};
const PAGE_SIZE = 25;
const MAX_COLUMNS = 4;

export interface RecordsListProps {
  objectKey: string;
  /** Page title (pack pages pass their navigation label). Defaults to the object's plural label. */
  title?: string;
  /** Where record links point: `${basePath}/<id>`. Defaults to /app/objects/<key>. */
  basePath?: string;
}

/** Records of a custom object: search, owner filter, sort, "Load more", create sheet, cards under 640 px. */
export function RecordsList({ objectKey, title, basePath }: RecordsListProps) {
  const obj = useCustomObject(objectKey);
  if (obj.isPending) return <RecordsListSkeleton />;
  if (obj.isError && !isNotFound(obj.error)) {
    return (
      <div className="rounded-lg border border-border bg-surface shadow-card">
        <ErrorState
          title="This list did not load"
          onRetry={() => void obj.refetch()}
          retrying={obj.isRefetching}
        />
      </div>
    );
  }
  if (!obj.data || obj.data.archivedAt)
    return <RecordsNotFound kind="object" backHref="/app" backLabel="Go to the dashboard" />;
  return (
    <RecordsListBody
      object={obj.data}
      title={title ?? obj.data.labelPlural}
      basePath={basePath ?? objectRecordsHref(objectKey)}
    />
  );
}

function RecordsListBody({
  object,
  title,
  basePath,
}: {
  object: CustomObject;
  title: string;
  basePath: string;
}) {
  const me = useMe();
  const router = useRouter();
  const canCreate = useCan('records.create');
  const fields = useObjectFields(object);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [owner, setOwner] = useState<OwnerFilter>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [createOpen, setCreateOpen] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  const filterKey = JSON.stringify({ q, owner, sort });
  const [paging, setPaging] = useState({ key: filterKey, cursors: [] as string[] });
  if (paging.key !== filterKey) setPaging({ key: filterKey, cursors: [] });

  const base: Partial<CustomRecordListQuery> = {
    ...(q ? { q } : {}),
    ...(owner !== 'all' ? { ownerId: owner } : {}),
    sort: SORTS[sort].sort,
    dir: SORTS[sort].dir,
    limit: PAGE_SIZE,
  };
  const pages = useQueries({
    queries: [undefined, ...paging.cursors].map((cursor, i) => {
      const query = cursor ? { ...base, cursor } : base;
      return {
        queryKey: recordKeys.list(object.key, query),
        queryFn: () => getCustomizationSource().listRecords(object.key, query),
        ...(i === 0 ? { placeholderData: keepPreviousData } : {}),
      };
    }),
  });
  const first = pages[0]!;
  const last = pages.at(-1)!;
  const rows: CustomRecord[] = pages.flatMap((p) => p.data?.items ?? []);
  const total = first.data?.total;
  const filtered = !!q || owner !== 'all';
  const singular = object.labelSingular;
  const plural = object.labelPlural;

  const primary = fields.find((f) => f.key === object.primaryFieldKey);
  const columns = fields
    .filter(
      (f) =>
        f.key !== object.primaryFieldKey &&
        f.type !== 'file' &&
        !(f.type === 'text' && (f.config as { multiline?: boolean }).multiline),
    )
    .slice(0, MAX_COLUMNS);
  const href = (id: string) => `${basePath}/${id}`;

  const clearFilters = () => {
    setSearch('');
    setOwner('all');
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          aria-hidden
          className="inline-flex size-8 items-center justify-center rounded-md bg-accent-soft text-accent-soft-fg"
        >
          <ObjectIcon name={object.icon} />
        </span>
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-xl font-semibold">{title}</h1>
          <span className="tabular text-sm text-muted-strong" aria-live="polite">
            {total === undefined ? (
              <span
                aria-hidden
                className="inline-block h-3.5 w-8 animate-pulse rounded-md bg-skeleton align-middle"
              />
            ) : (
              total.toLocaleString('en-IN')
            )}
            <span className="sr-only">
              {' '}
              {total === 1 ? singular.toLowerCase() : plural.toLowerCase()}
            </span>
          </span>
        </div>
        {canCreate && (
          <Button
            variant="primary"
            className="ml-auto h-11 sm:h-8"
            onClick={() => setCreateOpen(true)}
          >
            <Plus aria-hidden />
            New {singular.toLowerCase()}
          </Button>
        )}
      </header>
      {object.description && (
        <p className="-mt-1 max-w-2xl text-sm text-muted-strong">{object.description}</p>
      )}

      <div
        role="search"
        aria-label={`Filter ${plural.toLowerCase()}`}
        className="flex flex-wrap items-center gap-2"
      >
        <div className="relative w-full sm:w-64 lg:w-80">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${plural.toLowerCase()} by ${primary?.label.toLowerCase() ?? 'name'}`}
            aria-label={`Search ${plural.toLowerCase()}`}
            className="h-11 pr-9 pl-8 sm:h-8"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="focus-ring absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:text-fg sm:size-6"
            >
              <X aria-hidden className="size-4" />
            </button>
          )}
        </div>
        <Select
          aria-label="Owner"
          className="h-11 w-[calc(50%-0.25rem)] sm:h-8 sm:w-40"
          value={owner}
          onValueChange={(v) => setOwner(v as OwnerFilter)}
          options={(Object.keys(OWNER_LABEL) as OwnerFilter[]).map((k) => ({
            value: k,
            label: (
              <span className="inline-flex items-center gap-1.5">
                <UserRound aria-hidden className="size-3.5 text-muted" />
                {OWNER_LABEL[k]}
              </span>
            ),
          }))}
        />
        <Select
          aria-label="Sort"
          className="h-11 w-[calc(50%-0.25rem)] sm:h-8 sm:w-44"
          value={sort}
          onValueChange={(v) => setSort(v as SortKey)}
          options={(Object.keys(SORTS) as SortKey[]).map((k) => ({
            value: k,
            label: (
              <span className="inline-flex items-center gap-1.5">
                <ArrowDownUp aria-hidden className="size-3.5 text-muted" />
                {SORTS[k].label}
              </span>
            ),
          }))}
        />
      </div>

      {first.isPending ? (
        <div
          role="status"
          aria-busy="true"
          aria-label={`Loading ${plural.toLowerCase()}`}
          className="flex flex-col gap-px overflow-hidden rounded-lg border border-border"
        >
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 rounded-none" />
          ))}
        </div>
      ) : first.isError ? (
        <div className="rounded-lg border border-border bg-surface shadow-card">
          <ErrorState
            title={`${plural} did not load`}
            description="The connection dropped while loading. Your search is kept; try again."
            onRetry={() => void first.refetch()}
            retrying={first.isRefetching}
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface shadow-card">
          {filtered ? (
            <EmptyState
              title={`No ${plural.toLowerCase()} match`}
              description={
                q ? `Nothing matches "${q}" with these filters.` : 'Nothing matches these filters.'
              }
              action={
                <Button onClick={clearFilters} className="h-11 sm:h-8">
                  Clear search and filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<ObjectIcon name={object.icon} />}
              title={`No ${plural.toLowerCase()} yet`}
              description={
                canCreate
                  ? `Add your first ${singular.toLowerCase()} to keep the details in one place.`
                  : `${plural} added by your team appear here.`
              }
              action={
                canCreate ? (
                  <Button
                    variant="primary"
                    onClick={() => setCreateOpen(true)}
                    className="h-11 sm:h-8"
                  >
                    <Plus aria-hidden />
                    Add {singular.toLowerCase()}
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>
      ) : (
        <div
          className={cn(
            'flex flex-col gap-3 transition-opacity duration-150',
            first.isPlaceholderData && 'opacity-70',
          )}
        >
          <RecordsTable
            rows={rows}
            primary={primary}
            columns={columns}
            href={href}
            fresh={fresh}
            sort={sort}
            meId={me?.user.id ?? null}
            onOpen={(id) => router.push(href(id))}
            caption={`${plural}, ${SORTS[sort].label.toLowerCase()}`}
          />
          <RecordCards
            rows={rows}
            columns={columns.slice(0, 2)}
            href={href}
            fresh={fresh}
            meId={me?.user.id ?? null}
            label={plural}
          />
          <div className="flex flex-col items-center gap-1.5 pt-1">
            <p className="tabular text-xs text-muted-strong" aria-live="polite">
              Showing {rows.length.toLocaleString('en-IN')} of{' '}
              {(total ?? rows.length).toLocaleString('en-IN')}
            </p>
            {last.data?.nextCursor && (
              <Button
                className="h-11 sm:h-8"
                loading={last.isFetching}
                onClick={() =>
                  setPaging({
                    key: filterKey,
                    cursors: [...paging.cursors, last.data!.nextCursor!],
                  })
                }
              >
                Load more
              </Button>
            )}
            {last.isError && (
              <Button className="h-11 sm:h-8" onClick={() => void last.refetch()}>
                More {plural.toLowerCase()} did not load. Try again
              </Button>
            )}
          </div>
        </div>
      )}

      {canCreate && (
        <RecordCreateSheet
          object={object}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(r) => {
            setFresh(r.id);
            if (filtered || sort !== 'newest') {
              clearFilters();
              setSort('newest');
            }
          }}
        />
      )}
    </div>
  );
}

function OwnerCell({ ownerId, meId }: { ownerId: string | null; meId: string | null }) {
  const u = ownerId ? USER_BY_ID.get(ownerId) : null;
  if (!ownerId) return <span className="text-muted">Unassigned</span>;
  const name = u?.name ?? 'Former teammate';
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar name={name} size="xs" aria-hidden />
      <span className="truncate">{ownerId === meId ? `${name} (you)` : name}</span>
    </span>
  );
}

function RecordsTable({
  rows,
  primary,
  columns,
  href,
  fresh,
  sort,
  meId,
  onOpen,
  caption,
}: {
  rows: CustomRecord[];
  primary: FieldDef | undefined;
  columns: FieldDef[];
  href: (id: string) => string;
  fresh: string | null;
  sort: SortKey;
  meId: string | null;
  onOpen: (id: string) => void;
  caption: string;
}) {
  const ariaSort = (k: 'title' | 'updated') =>
    k === 'title' && sort === 'title'
      ? 'ascending'
      : k === 'updated' && sort === 'updated'
        ? 'descending'
        : undefined;
  return (
    <div className="hidden overflow-hidden rounded-lg border border-border bg-surface shadow-card sm:block">
      <Table containerClassName="max-h-[70vh]">
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow className="hover:bg-surface">
            <TableHead aria-sort={ariaSort('title')}>{primary?.label ?? 'Name'}</TableHead>
            {columns.map((c, i) => (
              <TableHead key={c.key} className={cn(i >= 2 && 'hidden lg:table-cell')}>
                {c.label}
              </TableHead>
            ))}
            <TableHead className="hidden md:table-cell">Owner</TableHead>
            <TableHead aria-sort={ariaSort('updated')} className="text-right">
              Updated
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.id}
              data-new={r.id === fresh || undefined}
              className="cursor-pointer"
              onClick={(e) => !(e.target as HTMLElement).closest('a,button') && onOpen(r.id)}
            >
              <TableCell className="max-w-72 font-medium">
                <Link
                  href={href(r.id)}
                  className="focus-ring block truncate rounded-xs text-fg hover:text-accent-text hover:underline"
                >
                  {r.title || 'Untitled'}
                </Link>
              </TableCell>
              {columns.map((c, i) => (
                <TableCell key={c.key} className={cn('max-w-56', i >= 2 && 'hidden lg:table-cell')}>
                  <div className="flex min-w-0">
                    <CustomFieldDisplay def={c} value={r.values[c.key]} compact />
                  </div>
                </TableCell>
              ))}
              <TableCell className="hidden max-w-48 md:table-cell">
                <OwnerCell ownerId={r.ownerId} meId={meId} />
              </TableCell>
              <TableCell className="tabular text-right text-fg-secondary">
                <time dateTime={r.updatedAt}>{timeAgo(r.updatedAt)}</time>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RecordCards({
  rows,
  columns,
  href,
  fresh,
  meId,
  label,
}: {
  rows: CustomRecord[];
  columns: FieldDef[];
  href: (id: string) => string;
  fresh: string | null;
  meId: string | null;
  label: string;
}) {
  return (
    <ul aria-label={label} className="flex flex-col gap-2 sm:hidden">
      {rows.map((r) => (
        <li
          key={r.id}
          data-new={r.id === fresh || undefined}
          className="data-[new=true]:animate-row-in"
        >
          <Link
            href={href(r.id)}
            className="focus-ring flex min-h-11 flex-col gap-1.5 rounded-lg border border-border bg-surface p-3 shadow-card active:bg-surface-2"
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-semibold text-fg">
                {r.title || 'Untitled'}
              </span>
              <time dateTime={r.updatedAt} className="tabular shrink-0 text-2xs text-muted">
                {timeAgo(r.updatedAt)}
              </time>
            </span>
            {columns.length > 0 && (
              <span className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                {columns.map((c) => (
                  <span key={c.key} className="contents">
                    <span className="text-muted">{c.label}</span>
                    <span className="flex min-w-0 text-fg">
                      <CustomFieldDisplay def={c} value={r.values[c.key]} compact plain />
                    </span>
                  </span>
                ))}
              </span>
            )}
            <span className="text-xs text-fg-secondary">
              <OwnerCell ownerId={r.ownerId} meId={meId} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
