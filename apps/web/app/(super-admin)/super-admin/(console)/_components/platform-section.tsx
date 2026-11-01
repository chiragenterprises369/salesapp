'use client';

import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { PageHeader } from '@/components/common/page-header';
import { NavIcon } from '@/components/shell/nav-icon';
import { Input } from '@/components/ui/input';

/**
 * Super Admin list data. Wave 1: the platform API is not connected, so every list resolves empty
 * after a short load. Phase 9 (superadmin-panel) swaps the queryFn for /api/super/* calls.
 */
export function usePlatformList(section: string) {
  return useQuery({
    queryKey: ['platform', section],
    queryFn: async (): Promise<unknown[]> => {
      await new Promise((r) => setTimeout(r, 350));
      return [];
    },
    staleTime: Infinity,
  });
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
            <label className="relative w-full max-w-xs">
              <span className="sr-only">{searchLabel}</span>
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted" />
              <Input size="sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchLabel} className="pl-7" />
            </label>
          ) : undefined
        }
        empty={{ icon: <NavIcon name={icon} />, title: emptyTitle, description: emptyDescription }}
      />
    </div>
  );
}
