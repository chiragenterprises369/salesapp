'use client';

import type { Task } from '@vistar/shared';
import { DAY_MS, istDayStart } from '@vistar/shared/fixtures';
import { ChevronLeft, ChevronRight, Workflow } from 'lucide-react';
import { useState } from 'react';
import { formatTimeIn } from '@/components/common/time';
import { PANEL, TOUCH } from '@/components/reports/page-kit';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { dueState, groupByWeekDay, weekStart } from './logic';

const MAX_PER_DAY = 8;

/** Simple week calendar (Mon-Sun, workspace timezone): tasks by due day; seven columns on desktop, a day list on phones. */
export function WeekView({ tasks, now, timeZone }: { tasks: readonly Task[]; now: number; timeZone: string }) {
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const start = weekStart(now, offset);
  const days = groupByWeekDay(tasks, start);
  const today = istDayStart(now);
  const fmt = (t: number, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { timeZone, ...o }).format(new Date(t + 60_000));
  const label = `${fmt(start, { day: 'numeric', month: 'short' })} to ${fmt(start + 6 * DAY_MS, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const total = days.reduce((a, d) => a + d.length, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="icon" className={TOUCH} aria-label="Previous week" onClick={() => setOffset((o) => o - 1)}>
          <ChevronLeft aria-hidden />
        </Button>
        <Button variant="secondary" size="icon" className={TOUCH} aria-label="Next week" onClick={() => setOffset((o) => o + 1)}>
          <ChevronRight aria-hidden />
        </Button>
        <h2 className="text-sm font-semibold text-fg" aria-live="polite">
          {label}
          <span className="ml-2 text-xs font-normal text-muted-strong">{total.toLocaleString('en-IN')} tasks</span>
        </h2>
        {offset !== 0 && (
          <Button variant="ghost" size="sm" className={TOUCH} onClick={() => setOffset(0)}>
            This week
          </Button>
        )}
      </div>
      <ol className="grid grid-cols-1 gap-2 md:grid-cols-7" aria-label={`Tasks for the week of ${label}`}>
        {days.map((list, i) => {
          const day = start + i * DAY_MS;
          const isToday = day === today;
          const open = list.filter((t) => t.status === 'open').length;
          return (
            <li key={day} className="min-w-0">
              <Card className={cn('flex h-full min-h-28 flex-col', PANEL, isToday && 'border-status-indigo-border')}>
                <h3 className="flex items-baseline justify-between gap-2 border-b border-border px-2.5 py-2 text-xs font-semibold text-fg">
                  <span>
                    {fmt(day, { weekday: 'short' })} <span className="font-normal text-muted">{fmt(day, { day: 'numeric', month: 'short' })}</span>
                    {isToday && <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-px text-2xs font-medium text-accent-soft-fg">Today</span>}
                  </span>
                  <span className="tabular text-2xs font-normal text-muted">{list.length ? `${open} open` : ''}</span>
                </h3>
                {list.length === 0 ? (
                  <p className="px-2.5 py-3 text-xs text-muted">Nothing due</p>
                ) : (
                  <ul className="flex flex-col gap-1 p-1.5">
                    {list.slice(0, expanded.has(day) ? undefined : MAX_PER_DAY).map((t) => {
                      const s = dueState(t, now);
                      return (
                        <li
                          key={t.id}
                          className={cn(
                            'rounded-md border px-2 py-1.5 text-xs',
                            s === 'done' ? 'border-border bg-surface-2 text-muted-strong line-through' : s === 'overdue' ? 'border-status-red-border bg-status-red-bg text-status-red-fg' : 'border-border bg-surface text-fg',
                          )}
                        >
                          <span className="tabular mr-1 font-medium">{t.dueAt ? formatTimeIn(t.dueAt, timeZone) : ''}</span>
                          {t.source === 'workflow' && <Workflow aria-label="From a workflow" className="mr-1 inline size-3 align-[-2px]" />}
                          <span className="break-words">{t.title}</span>
                          {s === 'overdue' && <span className="sr-only"> (overdue)</span>}
                          {s === 'done' && <span className="sr-only"> (done)</span>}
                        </li>
                      );
                    })}
                    {list.length > MAX_PER_DAY && !expanded.has(day) && (
                      <li>
                        <Button variant="link" size="sm" className={cn('px-2', TOUCH)} onClick={() => setExpanded((s) => new Set([...s, day]))}>
                          +{list.length - MAX_PER_DAY} more
                        </Button>
                      </li>
                    )}
                  </ul>
                )}
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
