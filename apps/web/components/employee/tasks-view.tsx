'use client';

import type { Task } from '@vistar/shared';
import { AlertCircle, CheckCircle2, ListTodo, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { useNow } from '@/components/common/use-now';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { useMe } from '@/lib/session/session';
import { DueChip, Section } from './today-view';
import { useMyDay } from './use-my-day';

const TYPE_LABEL: Record<Task['type'], string> = { todo: 'To-do', call: 'Call', follow_up: 'Follow-up', meeting: 'Meeting', email: 'Email' };

/**
 * My tasks and reminders grouped by when they are due. Completing is local (mock) with undo;
 * Wave 3: PATCH /tasks/{id} { status: 'done' }.
 */
export function TasksView() {
  const me = useMe()!;
  const tz = me.workspace.timezone;
  const now = useNow(60_000);
  const query = useMyDay();
  const [done, setDone] = useState<Set<string>>(new Set());

  const toggle = (t: Task) => {
    const wasDone = done.has(t.id);
    setDone((s) => {
      const next = new Set(s);
      if (wasDone) next.delete(t.id);
      else next.add(t.id);
      return next;
    });
    if (!wasDone) {
      toast.success('Task completed', {
        description: t.title,
        action: { label: 'Undo', onClick: () => setDone((s) => new Set([...s].filter((id) => id !== t.id))) },
      });
    }
  };

  const content = () => {
    if (query.isPending) {
      return (
        <div className="flex flex-col gap-3" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-lg" />
          ))}
        </div>
      );
    }
    if (query.isError) {
      return (
        <EmptyState
          icon={<AlertCircle />}
          title="Your tasks did not load"
          description="Check your connection, then try again."
          action={
            <Button size="touch" onClick={() => void query.refetch()}>
              <RotateCw aria-hidden />
              Try again
            </Button>
          }
        />
      );
    }
    const all = [...query.data.today.callsToMake, ...query.data.today.tasksDue, ...query.data.later].sort(
      (a, b) => Date.parse(a.dueAt ?? '') - Date.parse(b.dueAt ?? ''),
    );
    const endOfDay = (() => {
      const d = new Date(now || Date.parse(query.data.today.generatedAt));
      d.setHours(23, 59, 59, 999);
      return d.getTime();
    })();
    const open = all.filter((t) => !done.has(t.id));
    const groups = [
      { title: 'Overdue', items: open.filter((t) => now > 0 && Date.parse(t.dueAt ?? '') < now) },
      { title: 'Today', items: open.filter((t) => Date.parse(t.dueAt ?? '') >= now && Date.parse(t.dueAt ?? '') <= endOfDay) },
      { title: 'Later', items: open.filter((t) => Date.parse(t.dueAt ?? '') > endOfDay) },
      { title: 'Done', items: all.filter((t) => done.has(t.id)) },
    ].filter((g) => g.items.length > 0);

    if (open.length === 0 && done.size === 0) {
      return <EmptyState icon={<ListTodo />} title="No tasks" description="Tasks you add on a lead, and tasks from workflows, appear here." />;
    }
    return (
      <div className="flex flex-col gap-4">
        {open.length === 0 && (
          <EmptyState size="sm" icon={<CheckCircle2 />} title="All done for now" description="New tasks appear here as soon as they are assigned to you." />
        )}
        {groups.map((g) => (
          <Section key={g.title} title={g.title} count={g.items.length} icon={g.title === 'Done' ? <CheckCircle2 /> : <ListTodo />}>
            <ul>
              {g.items.map((t) => {
                const isDone = done.has(t.id);
                return (
                  <li key={t.id} className="flex min-h-14 items-start gap-1 rounded-md px-1 py-1 hover:bg-surface-2">
                    <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md">
                      <input type="checkbox" className="size-5 accent-accent" checked={isDone} onChange={() => toggle(t)} aria-label={`${isDone ? 'Reopen' : 'Complete'}: ${t.title}`} />
                    </label>
                    <div className="min-w-0 flex-1 py-2">
                      <p className={cn('text-sm font-medium', isDone ? 'text-muted line-through' : 'text-fg')}>{t.title}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Chip>{TYPE_LABEL[t.type]}</Chip>
                        {!isDone && <DueChip dueAt={t.dueAt} now={now} timeZone={tz} />}
                        {!isDone && (t.priority === 'high' || t.priority === 'urgent') && (
                          <Chip tone={t.priority === 'urgent' ? 'red' : 'amber'}>{t.priority === 'urgent' ? 'Urgent' : 'High'}</Chip>
                        )}
                        {t.leadId && t.leadName && (
                          <Link href={`/me/leads?lead=${t.leadId}`} className="focus-ring rounded-xs text-xs text-accent-text underline-offset-4 hover:underline">
                            {t.leadName}
                          </Link>
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        ))}
      </div>
    );
  };

  return (
    <RequirePermission anyOf={['tasks.read']}>
      <PageHeader title="Tasks and reminders" description="Everything you need to do, by due time. Tick a task when it is done." />
      {content()}
    </RequirePermission>
  );
}
