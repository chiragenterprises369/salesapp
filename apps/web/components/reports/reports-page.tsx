'use client';

import { formatInr, type LeadSource } from '@vistar/shared';
import { ArrowDown, ArrowUp, ArrowUpDown, BarChart3, Download } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useMemo, useState, type ReactNode } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { useNow } from '@/components/common/use-now';
import { SOURCE_LABEL } from '@/components/leads/lead-meta';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { useMe } from '@/lib/session/session';
import { downloadCsv, toCsv, type CsvCell } from './csv';
import { useForecast, useReport } from './data';
import { presetRange, previousRange, RANGE_LABEL, rangeLabel, toDateInput, type Range, type RangePreset } from './date-range';
import { callDayTotals, change, reportKpis, slaShares, sortReps, successRate, type RepSortKey } from './logic';
import { ErrorBlock, FilterPills, SectionCard, StatSkeleton, StatTile, TOUCH } from './page-kit';

const CallsByDayChart = dynamic(() => import('./calls-chart'), { ssr: false, loading: () => <Skeleton className="h-56 w-full" /> });

type Preset = Exclude<RangePreset, 'custom' | 'yesterday'>;
const PRESETS: readonly Preset[] = ['today', '7d', '30d', 'this_month', 'last_month'];
const SLA_TONE = ['bg-chart-2', 'bg-chart-1', 'bg-chart-4', 'bg-chart-5'] as const;

function CsvButton({ name, range, head, rows }: { name: string; range: Range; head: string[]; rows: CsvCell[][] }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className={TOUCH}
      aria-label={`Export ${name} as CSV`}
      onClick={() => {
        downloadCsv(`vistar-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${toDateInput(range.from)}-to-${toDateInput(range.to - 1)}`, toCsv(head, rows));
        toast.success(`${name} exported`, { description: `${rows.length} rows as CSV` });
      }}
    >
      <Download aria-hidden />
      CSV
    </Button>
  );
}

function Delta({ value, lowerIsBetter }: { value: number | null; lowerIsBetter?: boolean }): ReactNode {
  if (value === null) return 'No data for the previous period';
  const good = lowerIsBetter ? value <= 0 : value >= 0;
  return (
    <span className={good ? 'text-success-text' : 'text-danger-text'}>
      {value >= 0 ? '+' : ''}
      {value}% vs previous period
    </span>
  );
}

function SortHead({ label, k, sort, onSort, className }: { label: string; k: RepSortKey; sort: { key: RepSortKey; dir: 'asc' | 'desc' }; onSort: (k: RepSortKey) => void; className?: string }) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={className}>
      <button type="button" onClick={() => onSort(k)} className="focus-ring inline-flex items-center gap-1 rounded-xs hover:text-fg">
        {label}
        <Icon aria-hidden className={cn('size-3', !active && 'opacity-50')} />
      </button>
    </TableHead>
  );
}

const pctText = (v: number | null) => (v === null ? '–' : `${v}%`);

/**
 * Reports (/app/reports): conversion funnel, source ROI, rep performance, response-time SLA, call
 * analytics, workflow performance and revenue forecast for a date range, compared with the previous
 * range. Managers see their team; viewers read only. Each table exports what is on screen as CSV.
 */
export function ReportsPage() {
  const me = useMe();
  const now = useNow(60_000);
  const [preset, setPreset] = useState<Preset>('30d');
  const [sort, setSort] = useState<{ key: RepSortKey; dir: 'asc' | 'desc' }>({ key: 'revenueInr', dir: 'desc' });
  const range = useMemo(() => (now ? presetRange(preset, now) : null), [preset, now]);
  const prev = useMemo(() => (range ? previousRange(range) : null), [range]);
  const report = useReport(range);
  const before = useReport(prev);
  const forecast = useForecast();

  const s = range ? report.data : undefined;
  const k = useMemo(() => (s ? reportKpis(s) : null), [s]);
  const pk = useMemo(() => (before.data ? reportKpis(before.data) : null), [before.data]);
  const reps = useMemo(() => (s ? sortReps(s.reps, sort.key, sort.dir) : []), [s, sort]);
  const onSort = (key: RepSortKey) => setSort((x) => (x.key === key ? { key, dir: x.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'avgResponseMin' ? 'asc' : 'desc' }));
  const scopeChip = me?.role.dataScope === 'team' ? <Chip tone="indigo">Your team only</Chip> : me?.role.kind === 'viewer' ? <Chip>Read-only</Chip> : undefined;
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const prevHasData = !!pk && pk.leads > 0;

  const content = () => {
    if (!range || report.isPending) {
      return (
        <>
          <StatSkeleton count={5} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-72 rounded-lg lg:col-span-2" />
            <Skeleton className="h-72 rounded-lg" />
          </div>
          <Skeleton className="h-80 rounded-lg" />
        </>
      );
    }
    if (report.isError || !s || !k) return <ErrorBlock title="Reports did not load" onRetry={() => void report.refetch()} />;
    if (k.leads === 0 && k.calls === 0)
      return <EmptyState icon={<BarChart3 />} title="No activity in this period" description="Pick a longer date range. Reports fill in as leads and calls come in." />;

    const top = s.funnel[0]?.count || 1;
    const sla = slaShares(s.responseSla);
    const days = s.callsByDay.map((d) => ({ ...d, label: new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d.date}T12:00:00Z`)) }));
    const dayTotals = callDayTotals(s.callsByDay);
    const forecastTotal = forecast.data?.reduce((a, r) => a + r.weightedInr, 0) ?? s.forecastInr;
    const range0 = range;

    return (
      <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label="Report totals">
          <StatTile label="New leads" value={k.leads.toLocaleString('en-IN')} hint={<Delta value={prevHasData ? change(k.leads, pk!.leads) : null} />} />
          <StatTile label="Deals won" value={k.wonDeals.toLocaleString('en-IN')} hint={<Delta value={prevHasData ? change(k.wonDeals, pk!.wonDeals) : null} />} />
          <StatTile label="Revenue won" value={formatInr(k.revenueInr, { compact: true })} hint={<Delta value={prevHasData ? change(k.revenueInr, pk!.revenueInr) : null} />} />
          <StatTile label="Lead to won" value={`${k.conversionPct}%`} hint={`${k.avgResponseMin ?? '–'} min average first response`} />
          <StatTile label="Weighted forecast" value={formatInr(forecastTotal, { compact: true })} hint="Open pipeline × stage probability" className="col-span-2 md:col-span-1" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <SectionCard
            title="Conversion funnel"
            description={`Leads created ${rangeLabel(range0, tz)} that reached each stage`}
            className="lg:col-span-2"
            actions={<CsvButton name="Conversion funnel" range={range0} head={['Stage', 'Leads', 'Value (INR)', 'Share of new leads %']} rows={s.funnel.map((f) => [f.name, f.count, f.valueInr, Math.round((f.count / top) * 100)])} />}
          >
            <Table aria-label="Conversion funnel">
              <TableHeader sticky={false}>
                <TableRow className="hover:bg-surface">
                  <TableHead className="w-28">Stage</TableHead>
                  <TableHead>
                    <span className="sr-only">Share bar</span>
                  </TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Value</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.funnel.map((f, i) => {
                  const share = Math.round((f.count / top) * 100);
                  return (
                    <TableRow key={f.stageId}>
                      <TableCell className="font-medium">{f.name}</TableCell>
                      <TableCell className="w-full min-w-24">
                        <span aria-hidden className="relative block h-5 overflow-hidden rounded-sm bg-surface-2">
                          <span className="absolute inset-y-0 left-0 rounded-sm bg-chart-1 transition-[width] duration-250 ease-standard" style={{ width: `${Math.max(share, f.count ? 2 : 0)}%`, opacity: 1 - i * 0.14 }} />
                        </span>
                      </TableCell>
                      <TableCell className="tabular text-right">{f.count.toLocaleString('en-IN')}</TableCell>
                      <TableCell className="tabular hidden text-right text-fg-secondary sm:table-cell">{formatInr(f.valueInr, { compact: true })}</TableCell>
                      <TableCell className="tabular text-right">{share}%</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard title="Response-time SLA" description="Time from a new lead to the first call or WhatsApp" actions={<CsvButton name="Response SLA" range={range0} head={['Bucket', 'Leads', 'Share %']} rows={sla.map((b) => [b.label, b.count, b.pct])} />}>
            <div aria-hidden className="flex h-4 overflow-hidden rounded-full bg-surface-3">
              {sla.map((b, i) => (
                <span key={b.key} className={cn('h-full', SLA_TONE[i])} style={{ width: `${b.pct}%` }} />
              ))}
            </div>
            <dl className="mt-4 flex flex-col gap-2.5">
              {sla.map((b, i) => (
                <div key={b.key} className="flex items-center gap-2 text-sm">
                  <span aria-hidden className={cn('size-2.5 shrink-0 rounded-xs', SLA_TONE[i])} />
                  <dt className="flex-1 text-fg-secondary">{b.label}</dt>
                  <dd className="tabular text-right">
                    <span className="font-semibold text-fg">{b.pct}%</span> <span className="text-xs text-muted">({b.count.toLocaleString('en-IN')})</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-muted">Target: first touch within 5 minutes for IndiaMART and website enquiries.</p>
          </SectionCard>
        </div>

        <SectionCard
          title="Rep performance"
          description={`Leads assigned, calls and revenue won ${rangeLabel(range0, tz)}`}
          bodyClassName="px-0 pb-0"
          actions={
            <CsvButton
              name="Rep performance"
              range={range0}
              head={['Rep', 'Leads', 'Calls', 'Answered %', 'Deals won', 'Revenue (INR)', 'Avg first response (min)']}
              rows={reps.map((r) => [r.user.name, r.leads, r.calls, r.answeredPct, r.won, r.revenueInr, r.avgResponseMin])}
            />
          }
        >
          <Table aria-label="Rep performance">
            <TableHeader sticky={false}>
              <TableRow className="hover:bg-surface">
                <SortHead label="Rep" k="name" sort={sort} onSort={onSort} />
                <SortHead label="Leads" k="leads" sort={sort} onSort={onSort} className="text-right" />
                <SortHead label="Calls" k="calls" sort={sort} onSort={onSort} className="hidden text-right sm:table-cell" />
                <SortHead label="Answered" k="answeredPct" sort={sort} onSort={onSort} className="hidden text-right md:table-cell" />
                <SortHead label="Won" k="won" sort={sort} onSort={onSort} className="text-right" />
                <SortHead label="Revenue" k="revenueInr" sort={sort} onSort={onSort} className="text-right" />
                <SortHead label="First response" k="avgResponseMin" sort={sort} onSort={onSort} className="hidden text-right lg:table-cell" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {reps.map((r) => (
                <TableRow key={r.user.id} data-rep-row>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <Avatar name={r.user.name} size="sm" />
                      <span className="truncate font-medium">{r.user.name}</span>
                    </span>
                  </TableCell>
                  <TableCell className="tabular text-right">{r.leads}</TableCell>
                  <TableCell className="tabular hidden text-right sm:table-cell">{r.calls}</TableCell>
                  <TableCell className="tabular hidden text-right md:table-cell">{r.answeredPct}%</TableCell>
                  <TableCell className="tabular text-right">{r.won}</TableCell>
                  <TableCell className="tabular text-right font-medium">{formatInr(r.revenueInr, { compact: true })}</TableCell>
                  <TableCell className="tabular hidden text-right lg:table-cell">{r.avgResponseMin === null ? '–' : `${r.avgResponseMin} min`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard
            title="Source ROI"
            description="Leads created in the period by source, and what they turned into"
            bodyClassName="px-0 pb-0"
            actions={<CsvButton name="Source ROI" range={range0} head={['Source', 'Leads', 'Won', 'Conversion %', 'Won value (INR)', 'Revenue per lead (INR)']} rows={s.sources.map((x) => [SOURCE_LABEL[x.source as LeadSource], x.leads, x.won, x.conversionPct, x.wonValueInr, x.leads ? Math.round(x.wonValueInr / x.leads) : 0])} />}
          >
            <Table aria-label="Source ROI">
              <TableHeader sticky={false}>
                <TableRow className="hover:bg-surface">
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Won</TableHead>
                  <TableHead className="text-right">Conversion</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Won value</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Per lead</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.sources.map((x) => (
                  <TableRow key={x.source}>
                    <TableCell className="font-medium">{SOURCE_LABEL[x.source as LeadSource]}</TableCell>
                    <TableCell className="tabular text-right">{x.leads.toLocaleString('en-IN')}</TableCell>
                    <TableCell className="tabular text-right">{x.won}</TableCell>
                    <TableCell className="tabular text-right">{x.conversionPct}%</TableCell>
                    <TableCell className="tabular hidden text-right sm:table-cell">{formatInr(x.wonValueInr, { compact: true })}</TableCell>
                    <TableCell className="tabular hidden text-right md:table-cell">{formatInr(x.leads ? Math.round(x.wonValueInr / x.leads) : 0, { compact: true })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard
            title="Revenue forecast"
            description="Open pipeline today, weighted by stage probability"
            bodyClassName="px-0 pb-0"
            actions={forecast.data && <CsvButton name="Revenue forecast" range={range0} head={['Stage', 'Probability %', 'Leads', 'Pipeline value (INR)', 'Weighted (INR)']} rows={forecast.data.map((r) => [r.name, r.probability, r.leads, r.valueInr, r.weightedInr])} />}
          >
            {forecast.isPending ? (
              <Skeleton className="mx-4 mb-4 h-40" />
            ) : forecast.isError || !forecast.data ? (
              <ErrorBlock className="m-4" title="The forecast did not load" onRetry={() => void forecast.refetch()} />
            ) : (
              <Table aria-label="Revenue forecast">
                <TableHeader sticky={false}>
                  <TableRow className="hover:bg-surface">
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Probability</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Leads</TableHead>
                    <TableHead className="text-right">Pipeline</TableHead>
                    <TableHead className="text-right">Weighted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {forecast.data.map((r) => (
                    <TableRow key={r.stageId}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="tabular text-right">{r.probability}%</TableCell>
                      <TableCell className="tabular hidden text-right sm:table-cell">{r.leads.toLocaleString('en-IN')}</TableCell>
                      <TableCell className="tabular text-right text-fg-secondary">{formatInr(r.valueInr, { compact: true })}</TableCell>
                      <TableCell className="tabular text-right font-medium">{formatInr(r.weightedInr, { compact: true })}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="hover:bg-surface">
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell />
                    <TableCell className="tabular hidden text-right font-semibold sm:table-cell">{forecast.data.reduce((a, r) => a + r.leads, 0).toLocaleString('en-IN')}</TableCell>
                    <TableCell className="tabular text-right font-semibold">{formatInr(forecast.data.reduce((a, r) => a + r.valueInr, 0), { compact: true })}</TableCell>
                    <TableCell className="tabular text-right font-semibold">{formatInr(forecastTotal, { compact: true })}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard
            title="Call analytics"
            description={`${dayTotals.total.toLocaleString('en-IN')} calls, ${dayTotals.answerRate}% answered${dayTotals.busiest ? `; busiest day ${days.find((d) => d.date === dayTotals.busiest!.date)?.label}` : ''}`}
            actions={<CsvButton name="Calls by day" range={range0} head={['Date', 'Answered', 'Missed']} rows={s.callsByDay.map((d) => [d.date, d.answered, d.missed])} />}
          >
            {days.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">No calls in this period.</p>
            ) : (
              <>
                <CallsByDayChart data={days} />
                <div aria-hidden className="mt-2 flex items-center gap-4 text-xs text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-xs bg-chart-1" /> Answered
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-xs bg-chart-5" /> Missed
                  </span>
                </div>
                <div className="sr-only">
                  <table>
                    <caption>Calls per day</caption>
                    <thead>
                      <tr>
                        <th scope="col">Day</th>
                        <th scope="col">Answered</th>
                        <th scope="col">Missed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((d) => (
                        <tr key={d.date}>
                          <th scope="row">{d.label}</th>
                          <td>{d.answered}</td>
                          <td>{d.missed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </SectionCard>

          <SectionCard
            title="Workflow performance"
            description="Runs of each automation (all time)"
            bodyClassName="px-0 pb-0"
            actions={<CsvButton name="Workflow performance" range={range0} head={['Workflow', 'Runs', 'Completed', 'Failed', 'Running', 'Success %']} rows={s.workflows.map((w) => [w.name, w.runs, w.completed, w.failed, w.active, successRate(w)])} />}
          >
            <Table aria-label="Workflow performance">
              <TableHeader sticky={false}>
                <TableRow className="hover:bg-surface">
                  <TableHead>Workflow</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Failed</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Running</TableHead>
                  <TableHead className="text-right">Success</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.workflows.map((w) => {
                  const rate = successRate(w);
                  return (
                    <TableRow key={w.workflowId}>
                      <TableCell className="max-w-56 truncate font-medium">{w.name}</TableCell>
                      <TableCell className="tabular text-right">{w.runs.toLocaleString('en-IN')}</TableCell>
                      <TableCell className={cn('tabular hidden text-right sm:table-cell', w.failed > 0 && 'text-danger-text')}>{w.failed}</TableCell>
                      <TableCell className="tabular hidden text-right sm:table-cell">{w.active}</TableCell>
                      <TableCell className="text-right">{rate === null ? <span className="text-muted">No runs</span> : <Chip tone={rate >= 95 ? 'green' : rate >= 80 ? 'amber' : 'red'}>{pctText(rate)}</Chip>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </SectionCard>
        </div>
      </>
    );
  };

  return (
    <RequirePermission anyOf={['reports.read']}>
      <div className="flex max-w-7xl flex-col gap-4">
        <PageHeader
          title="Reports"
          description={range ? `Pipeline, source, call and team performance · ${rangeLabel(range, tz)}` : 'Pipeline, source, call and team performance for any date range.'}
          meta={scopeChip}
          actions={<FilterPills label="Date range" value={preset} onChange={setPreset} options={PRESETS.map((p) => ({ value: p, label: RANGE_LABEL[p] }))} />}
          className="mb-0"
        />
        {content()}
      </div>
    </RequirePermission>
  );
}
