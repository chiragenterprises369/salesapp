'use client';

import type { AttendanceRegister } from '@vistar/shared';
import { CalendarDays, ChevronLeft, ChevronRight, Route, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { DataTable, columnClass, type DataColumn } from '@/components/common/data-table';
import { EmptyState } from '@/components/common/empty-state';
import { NativeSelect } from '@/components/common/native-select';
import { formatTimeIn } from '@/components/common/time';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { isApiRequestError } from '@/lib/api-error';
import { useTeams, useUsers } from '@/lib/api/directory';
import { useMe } from '@/lib/session/session';
import { useAttendanceRegister } from './data';
import { addDays, formatPlace, formatWorked, LATE_GRACE_MIN, lateMinutes, todayIn } from './logic';

type Row = AttendanceRegister['items'][number];

const STATUS: Record<Row['status'], { label: string; tone: 'green' | 'blue' | 'grey' | 'red' | 'neutral' }> = {
  present: { label: 'Checked in', tone: 'green' },
  checked_out: { label: 'Checked out', tone: 'blue' },
  absent: { label: 'Absent', tone: 'red' },
  holiday: { label: 'Holiday', tone: 'neutral' },
  off_day: { label: 'Off day', tone: 'grey' },
};

const COLUMNS: DataColumn[] = [
  { key: 'person', label: 'Person' },
  { key: 'status', label: 'Status' },
  { key: 'in', label: 'Check-in', hideBelow: 'md' },
  { key: 'out', label: 'Check-out', hideBelow: 'lg' },
  { key: 'hours', label: 'Hours', align: 'right' },
  { key: 'route', label: 'Route', align: 'right', hideBelow: 'sm' },
];

/** Daily attendance register: present, late, absent, hours, check-in and check-out places (D-063). */
export function RegisterView() {
  const me = useMe()!;
  const tz = me.workspace.timezone;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = todayIn(tz);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? (params.get('date') as string) : today;
  const teamId = params.get('team');
  const fieldStaffOnly = params.get('all') !== '1';
  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const register = useAttendanceRegister({ date, teamId, fieldStaffOnly });
  const teams = useTeams();
  const users = useUsers();
  const hoursOf = useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u.workingHours] as const)), [users.data]);

  const rows = register.data?.items ?? [];
  const lateOf = (r: Row) => (r.status === 'present' || r.status === 'checked_out' ? lateMinutes(r.firstCheckInAt, hoursOf.get(r.user.id) ?? me.workspace.businessHours, tz) : null);
  const lateCount = rows.filter((r) => lateOf(r) !== null).length;
  const disabled = isApiRequestError(register.error) && register.error.code === 'FEATURE_DISABLED';

  if (disabled)
    return <EmptyState title="Field tracking is off for your company" description="Ask Vistar support to switch on field tracking to see attendance." />;

  const status = register.isPending ? 'loading' : register.isError ? 'error' : rows.length === 0 ? 'empty' : 'ready';
  const summary = register.data?.summary;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Register filters">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Previous day" onClick={() => setParam({ date: addDays(date, -1) })}>
            <ChevronLeft aria-hidden />
          </Button>
          <label className="sr-only" htmlFor="attendance-date">
            Date
          </label>
          <Input id="attendance-date" type="date" value={date} max={today} onChange={(e) => e.target.value && setParam({ date: e.target.value === today ? null : e.target.value })} className="w-40" />
          <Button size="icon" variant="ghost" aria-label="Next day" disabled={date >= today} onClick={() => setParam({ date: addDays(date, 1) === today ? null : addDays(date, 1) })}>
            <ChevronRight aria-hidden />
          </Button>
          {date !== today && (
            <Button size="sm" variant="ghost" onClick={() => setParam({ date: null })}>
              <CalendarDays aria-hidden />
              Today
            </Button>
          )}
        </div>
        {me.role.dataScope === 'all' && (teams.data?.length ?? 0) > 0 && (
          <NativeSelect aria-label="Team" value={teamId ?? ''} onChange={(e) => setParam({ team: e.target.value || null })} wrapperClassName="w-48">
            <option value="">All teams</option>
            {teams.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
        )}
        <label className="flex h-8 items-center gap-2 text-sm text-fg-secondary">
          <input type="checkbox" checked={fieldStaffOnly} onChange={(e) => setParam({ all: e.target.checked ? null : '1' })} className="size-4 accent-accent" />
          Field staff only
        </label>
        {summary && (
          <ul className="ml-auto flex flex-wrap items-center gap-1.5" aria-label="Summary">
            <li>
              <Chip tone="green">{summary.present} checked in</Chip>
            </li>
            <li>
              <Chip tone="blue">{summary.checkedOut} checked out</Chip>
            </li>
            <li>
              <Chip tone="red">{summary.absent} absent</Chip>
            </li>
            <li>
              <Chip tone="amber">{lateCount} late</Chip>
            </li>
          </ul>
        )}
      </div>

      <DataTable
        label={`Attendance on ${date}`}
        columns={COLUMNS}
        status={status}
        onRetry={() => void register.refetch()}
        empty={{
          icon: <Users />,
          title: fieldStaffOnly ? 'No field staff in this list' : 'Nobody in this list',
          description: fieldStaffOnly
            ? 'Mark people as field staff in Team and roles. Their check-ins and hours show here.'
            : 'Nobody in your scope has a working day here.',
        }}
      >
        {rows.map((r) => {
          const s = STATUS[r.status];
          const late = lateOf(r);
          const first = r.sessions[0];
          const last = r.sessions[r.sessions.length - 1];
          const routeHref = `/app/attendance/routes?user=${r.user.id}&date=${date}`;
          return (
            <TableRow key={r.user.id} data-attendance-row={r.status}>
              <TableCell className={columnClass(COLUMNS[0]!)}>
                <span className="flex items-center gap-2">
                  <Avatar name={r.user.name} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-fg">{r.user.name}</span>
                    {!r.isFieldStaff && <span className="block text-xs text-muted-strong">Not field staff</span>}
                  </span>
                </span>
              </TableCell>
              <TableCell className={columnClass(COLUMNS[1]!)}>
                <span className="flex flex-wrap items-center gap-1">
                  <Chip tone={s.tone}>{s.label}</Chip>
                  {late !== null && (
                    <Chip tone="amber" title={`Checked in more than ${LATE_GRACE_MIN} minutes after the start of working hours`}>
                      Late {formatWorked(late)}
                    </Chip>
                  )}
                </span>
              </TableCell>
              <TableCell className={columnClass(COLUMNS[2]!)}>
                {first ? (
                  <span className="block">
                    <span className="tabular block text-fg">{formatTimeIn(first.checkInAt, tz)}</span>
                    <span className="tabular block text-xs text-muted-strong">{formatPlace(first.checkIn)}</span>
                  </span>
                ) : (
                  <span className="text-muted">-</span>
                )}
              </TableCell>
              <TableCell className={columnClass(COLUMNS[3]!)}>
                {last?.checkOutAt && last.checkOut ? (
                  <span className="block">
                    <span className="tabular block text-fg">
                      {formatTimeIn(last.checkOutAt, tz)}
                      {last.checkOutReason === 'end_of_day' && <span className="text-xs text-muted-strong"> (end of day)</span>}
                    </span>
                    <span className="tabular block text-xs text-muted-strong">{formatPlace(last.checkOut)}</span>
                  </span>
                ) : (
                  <span className="text-muted">{r.status === 'present' ? 'Still checked in' : '-'}</span>
                )}
              </TableCell>
              <TableCell className={columnClass(COLUMNS[4]!)}>
                <span className="tabular text-fg">{r.workedMin > 0 ? formatWorked(r.workedMin) : '-'}</span>
                {r.sessions.length > 1 && <span className="block text-xs text-muted-strong">{r.sessions.length} sessions</span>}
              </TableCell>
              <TableCell className={columnClass(COLUMNS[5]!)}>
                {r.sessions.length > 0 && r.isFieldStaff ? (
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={routeHref} aria-label={`Route of ${r.user.name} on ${date}`}>
                      <Route aria-hidden />
                      Route
                    </Link>
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          );
        })}
      </DataTable>
      <p className="text-xs text-muted-strong">
        Times are in {tz}. Late means a check-in more than {LATE_GRACE_MIN} minutes after the start of that person&apos;s working hours (or the company&apos;s business hours).
      </p>
    </div>
  );
}
