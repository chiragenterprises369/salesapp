'use client';

import type { LeadsViewMode, MeResponse } from '@vistar/shared';
import { Download, MoreHorizontal, Plus, Upload } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Suspense, useCallback, useState } from 'react';
import { LeadsBoardView } from '@/features/pipeline';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useLeadsList } from '@/lib/leads/data';
import { useLeadsViewState } from '@/lib/leads/state';
import { useLeadsViewMode } from '@/lib/leads/view-mode';
import { useCan, useMe, useSessionActions, useSessionStatus } from '@/lib/session/session';
import { useLabels } from '@/lib/customization';
import { labelOf } from '@vistar/shared';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { isMockData } from '@/lib/api/data-source';
import { LeadDrawer } from '@/components/lead-detail/lead-drawer';
import { useLeadDrawer } from '@/components/lead-detail/use-lead-drawer';
import { BulkActionsBar } from './bulk-actions-bar';
import { CreateLeadDialog } from './create-lead-dialog';
import { DateRangeFilter } from './date-range-filter';
import { FiltersButton, FiltersPanel } from './filters-panel';
import { exportLeadsCsv } from './import/export';
import { ImportDialog } from './import/import-dialog';
import { LeadsActions } from './leads-actions';
import { OwnerFilter } from './owner-filter';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './primitives/menu';
import { SavedViewsMenu } from './saved-views-menu';
import { LeadsSearch } from './search-input';
import { EmptyState } from './states';
import { useTablePrefs } from './stores';
import { TableView } from './table-view';
import { useFiltersUrlSync } from './use-filters-url-sync';
import { usePipelineStages } from './use-stages';
import { ViewSwitch } from './view-switch';

export type LeadsPanel = 'company' | 'employee';

/**
 * Leads page shared by /app/leads (Company) and /me/leads (Employee); data scope makes them differ.
 * Board is the default view; the Table is optional. Both read the same filters, selection and
 * cache, so switching views never resets anything.
 */
export function LeadsPage({ panel }: { panel: LeadsPanel }) {
  return (
    <Suspense fallback={<LeadsPageSkeleton />}>
      <LeadsPageGate panel={panel} />
    </Suspense>
  );
}

function LeadsPageGate({ panel }: { panel: LeadsPanel }) {
  const status = useSessionStatus();
  const me = useMe();
  const labels = useLabels();
  if (status === 'loading' || (status === 'authenticated' && !me)) return <LeadsPageSkeleton />;
  if (!me) {
    return (
      <EmptyState
        title={`Sign in to see your ${labelOf(labels, 'lead', { plural: true, lower: true })}`}
        description="Your session ended. Sign in again to continue where you left off."
      />
    );
  }
  return <LeadsWorkspace panel={panel} me={me} />;
}

function LeadsWorkspace({ panel, me }: { panel: LeadsPanel; me: MeResponse }) {
  const { updateSettings } = useSessionActions();
  const persist = useCallback(
    (m: LeadsViewMode) => updateSettings({ leadsViewMode: m }),
    [updateSettings],
  );
  const { mode, setMode } = useLeadsViewMode({
    userSetting: me.settings.leadsViewMode,
    workspaceDefault: me.workspace.defaultLeadsViewMode,
    persist,
  });
  useFiltersUrlSync();
  const drawer = useLeadDrawer();
  const reduced = useReducedMotion();
  const canCreate = useCan('leads.create');
  const canImport = useCan('leads.import');
  const canExport = useCan('leads.export');
  const filters = useLeadsViewState((s) => s.filters);
  const sort = useTablePrefs((s) => s.sort);
  const list = useLeadsList(filters, sort);
  const total = list.data?.pages[0]?.total;
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { byId, pipelineId, live } = usePipelineStages();
  // The Board needs the real default pipeline id (the static fallback ids exist only in mock data).
  const pipelineReady = live || isMockData();
  const labels = useLabels();
  const leadsTitle = labelOf(labels, 'lead', { plural: true });
  const leadLower = labelOf(labels, 'lead', { lower: true });
  const leadsLower = labelOf(labels, 'lead', { plural: true, lower: true });

  const runExport = async () => {
    setExporting(true);
    try {
      const n = await exportLeadsCsv(filters, sort, (id) => byId.get(id)?.name);
      toast.success(
        `Exported ${n.toLocaleString('en-IN')} ${n === 1 ? leadLower : leadsLower} to CSV`,
      );
    } catch {
      toast.error('Export did not finish. Try again.');
    } finally {
      setExporting(false);
    }
  };

  const view =
    mode === 'board' ? (
      pipelineReady ? (
        <LeadsBoardView pipelineId={pipelineId} density={panel === 'employee' ? 'compact' : 'default'} />
      ) : (
        <Skeleton className="h-[60vh] w-full" />
      )
    ) : (
      <TableView onCreate={canCreate ? () => setCreateOpen(true) : undefined} />
    );

  return (
    <LeadsActions open={drawer.open}>
      <div data-leads-page className="flex min-w-0 flex-col gap-3 px-4 pt-4 pb-4 md:px-6 md:pt-5">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="text-xl font-semibold">{leadsTitle}</h1>
            <span className="tabular text-sm text-muted-strong" aria-live="polite">
              {total === undefined ? (
                <span
                  aria-hidden
                  className="inline-block h-3.5 w-10 animate-pulse rounded-md bg-skeleton align-middle"
                />
              ) : (
                total.toLocaleString('en-IN')
              )}
              <span className="sr-only"> {total === 1 ? leadLower : leadsLower}</span>
            </span>
          </div>
          <ViewSwitch value={mode} onChange={setMode} />
          <div className="ml-auto flex items-center gap-2">
            {canImport && (
              <Button className="hidden md:inline-flex" onClick={() => setImportOpen(true)}>
                <Upload aria-hidden />
                Import
              </Button>
            )}
            {canExport && (
              <Button
                className="hidden md:inline-flex"
                loading={exporting}
                onClick={() => void runExport()}
              >
                <Download aria-hidden />
                Export
              </Button>
            )}
            {(canImport || canExport) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" className="md:hidden" aria-label="Import or export">
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canImport && (
                    <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                      <Upload aria-hidden />
                      Import CSV
                    </DropdownMenuItem>
                  )}
                  {canExport && (
                    <DropdownMenuItem onSelect={() => void runExport()}>
                      <Download aria-hidden />
                      Export CSV
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canCreate && (
              <Button
                variant="primary"
                onClick={() => setCreateOpen(true)}
                aria-label={`New ${leadLower}`}
              >
                <Plus aria-hidden />
                <span className="hidden sm:inline">New {leadLower}</span>
              </Button>
            )}
          </div>
        </header>

        <div
          className="flex flex-wrap items-center gap-2"
          role="search"
          aria-label={`Filter ${leadsLower}`}
        >
          <LeadsSearch className="w-full sm:w-64 lg:w-80" />
          {me.role.dataScope !== 'own' && <OwnerFilter />}
          <DateRangeFilter />
          <FiltersButton />
          <SavedViewsMenu mode={mode} onViewMode={setMode} />
        </div>

        <FiltersPanel />

        <div className="grid min-w-0">
          {reduced ? (
            <div className="col-start-1 row-start-1 min-w-0">{view}</div>
          ) : (
            <AnimatePresence initial={false}>
              <motion.div
                key={mode}
                className="col-start-1 row-start-1 min-w-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
              >
                {view}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>

      <BulkActionsBar panel={panel} />
      {canCreate && <CreateLeadDialog open={createOpen} onOpenChange={setCreateOpen} />}
      {canImport && <ImportDialog open={importOpen} onOpenChange={setImportOpen} />}
      <LeadDrawer panel={panel} />
    </LeadsActions>
  );
}

export function LeadsPageSkeleton() {
  return (
    <div
      className="flex flex-col gap-3 px-4 pt-4 md:px-6 md:pt-5"
      aria-busy="true"
      aria-label="Loading leads"
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="ml-auto h-8 w-28" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-full sm:w-64" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-96 w-72 shrink-0 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
