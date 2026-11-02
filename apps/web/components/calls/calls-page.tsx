'use client';

import { formatDuration, type Call, type CallOutcome, type ChipTone } from '@vistar/shared';
import { PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, Play, SearchX } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useDeferredValue, useMemo, useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { formatDateTimeIn } from '@/components/common/time';
import { useMediaQuery } from '@/components/common/use-media-query';
import { useNow } from '@/components/common/use-now';
import { formatPhone, useScopedUsers } from '@/components/leads/lead-meta';
import { customRange, presetRange, RANGE_LABEL, rangeLabel, toDateInput, type RangePreset } from '@/components/reports/date-range';
import { ErrorBlock, FilterPills, FilterSelect, ListSkeleton, PANEL, SearchField, ShowMore, StatSkeleton, StatTile, TOUCH } from '@/components/reports/page-kit';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { useCan, useMe } from '@/lib/session/session';
import { useCallLog, useCallsToday } from './data';
import { callTotals, filterCalls, type CallFilter } from './logic';
import { RecordingPlayer } from './recording-player';

export const OUTCOME: Record<CallOutcome, { label: string; tone: ChipTone }> = {
  answered: { label: 'Answered', tone: 'blue' },
  interested: { label: 'Interested', tone: 'green' },
  not_interested: { label: 'Not interested', tone: 'grey' },
  callback: { label: 'Call back', tone: 'amber' },
  missed: { label: 'Missed', tone: 'red' },
  wrong_number: { label: 'Wrong number', tone: 'grey' },
  voicemail: { label: 'Voicemail', tone: 'grey' },
};

const PAGE = 50;
type Preset = Exclude<RangePreset, 'custom'> | 'custom';

function OutcomeChip({ call }: { call: Call }) {
  if (call.outcome) return <Chip tone={OUTCOME[call.outcome].tone}>{OUTCOME[call.outcome].label}</Chip>;
  if (call.status === 'failed') return <Chip tone="red">Failed</Chip>;
  if (call.status === 'in_progress' || call.status === 'ringing') return <Chip tone="blue" dot>On call now</Chip>;
  return <Chip>No outcome</Chip>;
}

function Direction({ call }: { call: Call }) {
  const missed = call.status === 'missed' || call.status === 'failed';
  const Icon = missed ? PhoneMissed : call.direction === 'inbound' ? PhoneIncoming : PhoneOutgoing;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', missed ? 'text-danger-text' : 'text-fg-secondary')}>
      <Icon aria-hidden className="size-3.5" />
      {call.direction === 'inbound' ? 'Inbound' : 'Outbound'}
    </span>
  );
}

/** Calls (/app/calls): call log with filters, totals strip and a mock recording player. */
export function CallsPage() {
  const me = useMe();
  const now = useNow(60_000);
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const canRecordings = useCan('calls.recordings') && !(me?.impersonation && !me.impersonation.contentAccess);
  const showEmployee = !!me && me.role.dataScope !== 'own';
  const users = useScopedUsers();
  const wide = useMediaQuery('(min-width: 768px)');

  const [preset, setPreset] = useState<Preset>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [filter, setFilter] = useState<CallFilter>({ userId: 'all', outcome: 'all', direction: 'all', q: '' });
  const [limit, setLimit] = useState(PAGE);
  const [playing, setPlaying] = useState<string | null>(null);
  const q = useDeferredValue(filter.q);

  const range = useMemo(() => {
    if (!now) return null;
    if (preset === 'custom') return customRange(customFrom, customTo) ?? presetRange('7d', now);
    return presetRange(preset, now);
  }, [preset, customFrom, customTo, now]);

  const log = useCallLog(range ?? { from: 0, to: 1 });
  const today = useCallsToday(now);
  const rows = useMemo(() => (log.data ? filterCalls(log.data, { ...filter, q }) : []), [log.data, filter, q]);
  const totals = useMemo(() => callTotals(rows), [rows]);
  const todayTotals = useMemo(() => callTotals(today.data ? filterCalls(today.data, { ...filter, q: '' }) : []), [today.data, filter]);

  const set = (patch: Partial<CallFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setLimit(PAGE);
  };
  const filtered = filter.userId !== 'all' || filter.outcome !== 'all' || filter.direction !== 'all' || !!filter.q;
  const loading = log.isPending || !range;

  const body = () => {
    if (loading) return <ListSkeleton rows={10} />;
    if (log.isError) return <ErrorBlock title="The call log did not load" onRetry={() => void log.refetch()} />;
    if (rows.length === 0)
      return (
        <EmptyState
          size="sm"
          icon={filtered ? <SearchX /> : <PhoneCall />}
          title={filtered ? 'No calls match these filters' : 'No calls in this period'}
          description={filtered ? 'Clear the filters or pick a longer date range.' : 'Calls made with click-to-call from a lead appear here with duration, outcome and recording.'}
          action={filtered && <Button onClick={() => set({ userId: 'all', outcome: 'all', direction: 'all', q: '' })}>Clear filters</Button>}
        />
      );
    const shown = rows.slice(0, limit);
    const lead = (c: Call) =>
      c.leadId ? (
        <Link href={`/app/leads?lead=${c.leadId}`} className="focus-ring rounded-xs font-medium text-fg hover:text-accent-text hover:underline">
          {c.leadName ?? formatPhone(c.direction === 'inbound' ? c.from : c.to)}
        </Link>
      ) : (
        <span className="font-medium text-fg">{formatPhone(c.direction === 'inbound' ? c.from : c.to)}</span>
      );
    const playButton = (c: Call) =>
      c.hasRecording && canRecordings ? (
        <Button
          variant={playing === c.id ? 'secondary' : 'ghost'}
          size="icon-sm"
          className={TOUCH}
          aria-label={`${playing === c.id ? 'Hide' : 'Play'} recording: ${c.leadName ?? 'call'} at ${formatDateTimeIn(c.startedAt, tz)}`}
          aria-expanded={playing === c.id}
          onClick={() => setPlaying((p) => (p === c.id ? null : c.id))}
        >
          <Play aria-hidden />
        </Button>
      ) : c.hasRecording ? (
        <span className="text-xs text-muted" title="You cannot play recordings">
          Hidden
        </span>
      ) : (
        <span className="text-xs text-muted" aria-label="No recording">
          –
        </span>
      );

    return (
      <Card className={cn('overflow-hidden', PANEL)}>
        {wide ? (
          <Table aria-label={`Calls, ${rangeLabel(range)}`}>
            <TableHeader>
              <TableRow className="hover:bg-surface">
                <TableHead>Time</TableHead>
                <TableHead>Lead</TableHead>
                {showEmployee && <TableHead className="hidden lg:table-cell">Employee</TableHead>}
                <TableHead>Direction</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead className="hidden lg:table-cell">Disposition</TableHead>
                <TableHead className="hidden xl:table-cell">Notes</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Recording</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((c) => (
                <Fragment key={c.id}>
                  <TableRow data-call-row data-state={playing === c.id ? 'selected' : undefined}>
                    <TableCell className="tabular text-fg-secondary">{formatDateTimeIn(c.startedAt, tz)}</TableCell>
                    <TableCell className="max-w-48 truncate">{lead(c)}</TableCell>
                    {showEmployee && (
                      <TableCell className="hidden lg:table-cell">
                        {c.user ? (
                          <span className="inline-flex items-center gap-2">
                            <Avatar name={c.user.name} size="xs" />
                            <span className="truncate">{c.user.name}</span>
                          </span>
                        ) : (
                          '–'
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <Direction call={c} />
                    </TableCell>
                    <TableCell className="tabular text-right">{c.durationSec > 0 ? formatDuration(c.durationSec) : '0:00'}</TableCell>
                    <TableCell>
                      <OutcomeChip call={c} />
                    </TableCell>
                    <TableCell className="hidden max-w-48 truncate text-fg-secondary lg:table-cell">{c.disposition ?? '–'}</TableCell>
                    <TableCell className="hidden max-w-56 truncate text-muted xl:table-cell" title={c.notes ?? undefined}>
                      {c.notes ?? '–'}
                    </TableCell>
                    <TableCell className="text-right">{playButton(c)}</TableCell>
                  </TableRow>
                  {playing === c.id && (
                    <TableRow className="hover:bg-surface">
                      <TableCell colSpan={showEmployee ? 9 : 8} className="h-auto py-2 whitespace-normal">
                        <RecordingPlayer callId={c.id} durationSec={c.durationSec} title={c.leadName ?? 'call'} onClose={() => setPlaying(null)} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        ) : (
          <ul aria-label={`Calls, ${rangeLabel(range)}`}>
            {shown.map((c) => (
              <li key={c.id} data-call-row className="border-b border-border px-3 py-2.5 last:border-b-0">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{lead(c)}</p>
                    <p className="tabular text-xs text-muted">
                      {formatDateTimeIn(c.startedAt, tz)}
                      {showEmployee && c.user ? ` · ${c.user.name}` : ''}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Direction call={c} />
                      <OutcomeChip call={c} />
                      <span className="tabular text-xs text-fg-secondary">{formatDuration(c.durationSec)}</span>
                    </div>
                    {c.disposition && <p className="mt-1 text-xs text-fg-secondary">{c.disposition}</p>}
                  </div>
                  {playButton(c)}
                </div>
                {playing === c.id && (
                  <div className="mt-2">
                    <RecordingPlayer compact callId={c.id} durationSec={c.durationSec} title={c.leadName ?? 'call'} onClose={() => setPlaying(null)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <ShowMore shown={shown.length} total={rows.length} onMore={() => setLimit((l) => l + PAGE)} noun="calls" />
      </Card>
    );
  };

  return (
    <RequirePermission anyOf={['calls.read']}>
      <div className="flex flex-col gap-4">
        <PageHeader title="Calls" description="Every call made or received through Vistar, with outcome and recording." className="mb-0" />

        {today.isPending || log.isPending || !range ? (
          <StatSkeleton />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Call totals">
            <StatTile label="Calls today" value={todayTotals.total.toLocaleString('en-IN')} hint={`${todayTotals.connected} connected · ${todayTotals.missed} missed`} />
            <StatTile label="Connected rate" value={`${totals.connectedRate}%`} hint={`${totals.connected.toLocaleString('en-IN')} of ${totals.total.toLocaleString('en-IN')} · ${rangeLabel(range)}`} />
            <StatTile label="Average duration" value={formatDuration(totals.avgDurationSec)} hint="Connected calls, voicemail excluded" />
            <StatTile label="Talk time" value={formatDuration(totals.talkSec)} hint={`${totals.inbound.toLocaleString('en-IN')} inbound · ${totals.outbound.toLocaleString('en-IN')} outbound`} />
          </div>
        )}

        <div className="flex flex-col gap-2 xl:flex-row xl:flex-wrap xl:items-center">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <FilterSelect
              label="Date range"
              value={preset}
              onChange={(v) => {
                const next = v as Preset;
                if (next === 'custom' && range && !customFrom) {
                  setCustomFrom(toDateInput(range.from));
                  setCustomTo(toDateInput(range.to - 1));
                }
                setPreset(next);
                setLimit(PAGE);
              }}
              className="col-span-2 sm:w-40"
            >
              {(['today', 'yesterday', '7d', '30d', 'this_month', 'custom'] as const).map((p) => (
                <option key={p} value={p}>
                  {RANGE_LABEL[p]}
                </option>
              ))}
            </FilterSelect>
            {preset === 'custom' && (
              <>
                <label className="flex items-center gap-1.5 text-xs text-muted-strong">
                  From
                  <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-36 pointer-coarse:h-11" />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-strong">
                  To
                  <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-36 pointer-coarse:h-11" />
                </label>
              </>
            )}
            {showEmployee && (
              <FilterSelect label="Employee" value={filter.userId ?? 'all'} onChange={(v) => set({ userId: v })} className="sm:w-44">
                <option value="all">All employees</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </FilterSelect>
            )}
            <FilterSelect label="Outcome" value={filter.outcome ?? 'all'} onChange={(v) => set({ outcome: v as CallFilter['outcome'] })} className="sm:w-44">
              <option value="all">All outcomes</option>
              <option value="missed_any">Missed or failed</option>
              {(Object.keys(OUTCOME) as CallOutcome[]).map((o) => (
                <option key={o} value={o}>
                  {OUTCOME[o].label}
                </option>
              ))}
            </FilterSelect>
          </div>
          <FilterPills
            label="Direction"
            value={filter.direction ?? 'all'}
            onChange={(v) => set({ direction: v })}
            options={[
              { value: 'all', label: 'All' },
              { value: 'outbound', label: 'Outbound' },
              { value: 'inbound', label: 'Inbound' },
            ]}
          />
          <SearchField value={filter.q ?? ''} onChange={(v) => set({ q: v })} label="Search calls" placeholder="Search lead, number or notes" className="xl:ml-auto xl:w-64" />
        </div>

        {body()}
      </div>
    </RequirePermission>
  );
}
