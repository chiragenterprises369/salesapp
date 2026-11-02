'use client';

import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useDeferredValue, useState, type ReactNode } from 'react';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { PageHeader } from '@/components/common/page-header';
import { NavIcon } from '@/components/shell/nav-icon';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { isMockData } from '@/lib/api/data-source';
import { apiPlatformKpis, apiPlatformRows, platformKpis, platformRows, type PlatformCell, type PlatformRow } from '@/lib/world/platform';

/**
 * Super Admin list data: /api/super/* in API mode (sections without a shipped route show their empty
 * state); the test-only mock data mode reads the mock platform world (lib/world/platform).
 */
export function usePlatformList(section: string) {
  return useQuery({
    queryKey: ['platform', section],
    queryFn: async (): Promise<PlatformRow[]> => {
      if (!isMockData()) return apiPlatformRows(section);
      await new Promise((r) => setTimeout(r, 350));
      return platformRows(section);
    },
    staleTime: 60_000,
  });
}

export function usePlatformKpis() {
  return useQuery({
    queryKey: ['platform', 'overview-kpis'],
    queryFn: async () => {
      if (!isMockData()) return apiPlatformKpis();
      await new Promise((r) => setTimeout(r, 350));
      return platformKpis();
    },
    staleTime: 60_000,
  });
}

function Cell({ value, primary }: { value: PlatformCell | undefined; primary: boolean }) {
  if (value === undefined) return <span className="text-muted">–</span>;
  if (typeof value === 'string') return <span className={primary ? 'font-medium text-fg' : undefined}>{value}</span>;
  const main = value.tone ? (
    <Chip tone={value.tone} dot={value.tone !== 'neutral'}>
      {value.text}
    </Chip>
  ) : (
    <span className={cn(primary && 'font-medium text-fg', value.mono && 'font-mono text-xs')}>{value.text}</span>
  );
  return value.sub ? (
    <span className="flex min-w-0 flex-col">
      {main}
      <span className="truncate text-xs text-muted">{value.sub}</span>
    </span>
  ) : (
    main
  );
}

export function PlatformSection({
  section,
  title,
  description,
  icon,
  columns,
  emptyTitle,
  emptyDescription,
  searchLabel,
  children,
}: {
  section: string;
  title: string;
  description: string;
  icon: string;
  columns: DataColumn[];
  emptyTitle: string;
  emptyDescription: string;
  /** Adds a search field above the table (filters once data exists). */
  searchLabel?: string;
  /** Extra blocks above the table (KPI cards, notes). */
  children?: ReactNode;
}) {
  const query = usePlatformList(section);
  const [q, setQ] = useState('');
  const needle = useDeferredValue(q).trim().toLowerCase();
  const rows = (query.data ?? []).filter((r) => !needle || r.search.includes(needle));
  const status = query.isPending ? 'loading' : query.isError ? 'error' : (query.data?.length ?? 0) === 0 ? 'empty' : 'ready';

  return (
    <div className="flex max-w-7xl flex-col gap-4">
      <PageHeader title={title} description={description} className="mb-1" />
      {children}
      <DataTable
        label={title}
        columns={columns}
        status={status}
        onRetry={() => void query.refetch()}
        toolbar={
          searchLabel ? (
            <>
              <label className="relative w-full max-w-xs">
                <span className="sr-only">{searchLabel}</span>
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted" />
                <Input size="sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchLabel} className="pl-7" />
              </label>
              {status === 'ready' && (
                <span className="ml-auto text-xs text-muted tabular" aria-live="polite">
                  {rows.length} of {query.data?.length ?? 0}
                </span>
              )}
            </>
          ) : undefined
        }
        empty={{ icon: <NavIcon name={icon} />, title: emptyTitle, description: emptyDescription }}
      >
        {rows.length === 0 ? (
          <TableRow className="hover:bg-surface">
            <TableCell colSpan={columns.length} className="py-6 text-center text-sm text-muted">
              Nothing matches “{q}”. Try another name.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((r) => (
            <TableRow key={r.id}>
              {columns.map((c, i) => (
                <TableCell key={c.key} className={cn(columnClass(c), i === 0 && 'max-w-xs', 'py-2')}>
                  <Cell value={r.cells[c.key]} primary={i === 0} />
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </DataTable>
    </div>
  );
}
