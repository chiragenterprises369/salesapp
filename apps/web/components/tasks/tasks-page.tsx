'use client';

import type { Task } from '@vistar/shared';
import { CheckCircle2, ListTodo, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { useNow } from '@/components/common/use-now';
import { useScopedUsers } from '@/components/leads/lead-meta';
import { ErrorBlock, FilterPills, FilterSelect, ListSkeleton, PANEL, SearchField, ShowMore, Tabs } from '@/components/reports/page-kit';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { useCan, useMe } from '@/lib/session/session';
import { restoreTask, useTaskAction, useTaskEdits, useTasks, useViewer } from './data';
import { bucketCounts, filterTasks, matchesFilter, scopeTasks, type TaskBucket, type TaskTab, type TaskTypeFilter } from './logic';
import { TaskRow } from './task-row';
import { WeekView } from './week-view';

const PAGE = 50;

/**
 * Tasks (/app/tasks): my tasks and, with team or all data scope, team tasks. Due buckets, search,
 * owner and type filters, complete / reopen / snooze (optimistic, with Undo), list or week view.
 */
export function TasksPage() {
  const me = useMe();
  const viewer = useViewer();
  const now = useNow(60_000);
  const canTeam = !!me && me.role.dataScope !== 'own';
  const canEdit = useCan('tasks.update') && !me?.impersonation?.readOnly;
  const [tab, setTab] = useState<TaskTab>(me?.role.dataScope === 'all' ? 'team' : 'mine');
  const [view, setView] = useState<'list' | 'week'>('list');
  const [bucket, setBucket] = useState<TaskBucket>('open');
  const [q, setQ] = useState('');
  const [assigneeId, setAssigneeId] = useState('all');
  const [type, setType] = useState<TaskTypeFilter>('all');
  const [limit, setLimit] = useState(PAGE);
  const deferredQ = useDeferredValue(q);
  const panelId = useId();
  const users = useScopedUsers();

  const mine = useTasks('mine');
  const team = useTasks('team');
  const active = tab === 'team' && canTeam ? team : mine;
  const action = useTaskAction();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';

  // Defensive: the reader already scopes; this keeps the page correct if it ever returns more.
  const scoped = useMemo(() => (active.data ? scopeTasks(active.data, tab === 'team' && canTeam ? 'team' : 'mine', viewer) : []), [active.data, tab, canTeam, viewer]);
  const filter = useMemo(() => ({ q: deferredQ, assigneeId: tab === 'team' ? assigneeId : 'all', type }), [deferredQ, assigneeId, type, tab]);
  const matching = useMemo(() => scoped.filter((t) => matchesFilter(t, filter)), [scoped, filter]);
  const counts = useMemo(() => bucketCounts(matching, now), [matching, now]);
  const rows = useMemo(() => filterTasks(scoped, bucket, filter, now), [scoped, bucket, filter, now]);
  const openCount = (list: readonly Task[] | undefined) => (list ? list.filter((t) => t.status === 'open').length : undefined);

  const reset = () => setLimit(PAGE);
  const run = (task: Task, kind: 'complete' | 'reopen' | { until: number; label: string }) => {
    const previous = useTaskEdits.getState().patches[task.id];
    const undo = { label: 'Undo', onClick: () => restoreTask(task.id, previous) };
    const onError = () => toast.error('That change did not save', { description: 'The task is back as it was. Try again.' });
    if (kind === 'complete') {
      action.mutate({ task, action: { kind: 'complete' } }, { onError });
      toast.success('Task completed', { description: task.title, action: undo });
    } else if (kind === 'reopen') {
      action.mutate({ task, action: { kind: 'reopen' } }, { onError });
      toast('Task reopened', { description: task.title, action: undo });
    } else {
      action.mutate({ task, action: { kind: 'snooze', until: kind.until } }, { onError });
      toast(`Snoozed: ${kind.label.toLowerCase()}`, { description: task.title, action: undo });
    }
  };

  const bucketOptions = [
    { value: 'open' as const, label: 'All open', count: counts.open },
    { value: 'overdue' as const, label: 'Overdue', count: counts.overdue, alert: true },
    { value: 'today' as const, label: 'Due today', count: counts.today },
    { value: 'upcoming' as const, label: 'Upcoming', count: counts.upcoming },
    { value: 'done' as const, label: 'Done', count: counts.done },
  ];

  const body = () => {
    if (active.isPending || !now) return <ListSkeleton rows={8} />;
    if (active.isError) return <ErrorBlock title="Tasks did not load" onRetry={() => void active.refetch()} />;
    if (scoped.length === 0)
      return (
        <EmptyState
          icon={<ListTodo />}
          title={tab === 'mine' ? 'No tasks assigned to you' : 'No tasks in your team yet'}
          description="Tasks added on a lead, and call tasks created by workflows, appear here grouped by due time."
          action={
            <Button asChild variant="primary">
              <Link href="/app/leads">Open leads</Link>
            </Button>
          }
        />
      );
    if (view === 'week') return <WeekView tasks={scoped.filter((t) => matchesFilter(t, filter))} now={now} timeZone={tz} />;
    if (rows.length === 0)
      return (
        <EmptyState
          size="sm"
          icon={bucket === 'overdue' || bucket === 'today' ? <CheckCircle2 /> : <SearchX />}
          title={bucket === 'overdue' ? 'Nothing overdue' : bucket === 'today' ? 'Nothing else due today' : 'No tasks match'}
          description={q || type !== 'all' || assigneeId !== 'all' ? 'Clear the search or filters to see more tasks.' : 'Pick another filter to see more tasks.'}
          action={
            (q || type !== 'all' || assigneeId !== 'all') && (
              <Button
                onClick={() => {
                  setQ('');
                  setType('all');
                  setAssigneeId('all');
                }}
              >
                Clear filters
              </Button>
            )
          }
        />
      );
    return (
      <Card className={cn('overflow-hidden', PANEL)}>
        <ul aria-label={`${bucketOptions.find((b) => b.value === bucket)!.label} tasks`}>
          {rows.slice(0, limit).map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              now={now}
              timeZone={tz}
              leadsBase="/app/leads"
              showOwner={tab === 'team'}
              canEdit={canEdit}
              onComplete={(x) => run(x, 'complete')}
              onReopen={(x) => run(x, 'reopen')}
              onSnooze={(x, until, label) => run(x, { until, label })}
            />
          ))}
        </ul>
        <ShowMore shown={Math.min(limit, rows.length)} total={rows.length} onMore={() => setLimit((l) => l + PAGE)} noun="tasks" />
      </Card>
    );
  };

  const panel = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        {view === 'list' ? (
          <FilterPills
            label="Due"
            value={bucket}
            options={bucketOptions}
            onChange={(v) => {
              setBucket(v);
              reset();
            }}
          />
        ) : (
          <p className="text-xs text-muted-strong">Open and done tasks by due day. Overdue tasks are red.</p>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] lg:w-auto">
          <SearchField value={q} onChange={(v) => {
              setQ(v);
              reset();
            }} label="Search tasks" placeholder="Search tasks or leads" className="sm:w-64" />
          {tab === 'team' && canTeam && (
            <FilterSelect label="Owner" value={assigneeId} onChange={(v) => {
                setAssigneeId(v);
                reset();
              }}>
              <option value="all">All owners</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </FilterSelect>
          )}
          <FilterSelect label="Task type" value={type} onChange={(v) => {
              setType(v as TaskTypeFilter);
              reset();
            }}>
            <option value="all">All types</option>
            <option value="call">Calls</option>
            <option value="follow_up">Follow-ups</option>
            <option value="meeting">Meetings</option>
            <option value="email">Emails</option>
            <option value="todo">To-dos</option>
            <option value="workflow">From workflows</option>
          </FilterSelect>
        </div>
      </div>
      {body()}
    </div>
  );

  return (
    <RequirePermission anyOf={['tasks.read']}>
      <div className="flex max-w-6xl flex-col gap-4">
        <PageHeader
          title="Tasks"
          description="Follow-ups and to-dos for you and your team, sorted by due time."
          actions={<FilterPills label="Layout" value={view} options={[{ value: 'list', label: 'List' }, { value: 'week', label: 'Week' }]} onChange={setView} />}
          className="mb-0"
        />
        {canTeam ? (
          <>
            <Tabs
              label="Whose tasks"
              value={tab}
              panelId={panelId}
              onChange={(v) => {
                setTab(v);
                setAssigneeId('all');
                reset();
              }}
              tabs={[
                { value: 'mine', label: 'My tasks', count: openCount(mine.data) },
                { value: 'team', label: me?.role.dataScope === 'all' ? 'Team tasks (everyone)' : 'Team tasks', count: openCount(team.data) },
              ]}
            />
            <div id={panelId} role="tabpanel" aria-labelledby={`${panelId}-tab-${tab}`}>
              {panel}
            </div>
          </>
        ) : (
          panel
        )}
      </div>
    </RequirePermission>
  );
}
