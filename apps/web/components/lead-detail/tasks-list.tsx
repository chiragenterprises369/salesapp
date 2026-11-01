'use client';

import type { Task } from '@vistar/shared';
import { addDays, setHours, setMinutes } from 'date-fns';
import { AlarmClock, Plus, Workflow } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { formatFollowUp, isOverdue } from '@/components/leads/lead-meta';
import { Checkbox } from '@/components/leads/primitives/checkbox';

const PRIORITY_TONE: Record<Task['priority'], 'grey' | 'neutral' | 'amber' | 'red'> = {
  low: 'grey',
  normal: 'neutral',
  high: 'amber',
  urgent: 'red',
};

/** Tasks on the lead (mock). Complete with the checkbox; add a quick task due tomorrow 10:00. */
export function TasksList({
  tasks,
  canEdit,
  onToggle,
  onAdd,
}: {
  tasks: Task[];
  canEdit: boolean;
  onToggle: (task: Task, done: boolean) => void;
  onAdd: (title: string, dueAt: string) => void;
}) {
  const [title, setTitle] = useState('');
  const open = tasks.filter((t) => t.status === 'open');
  const done = tasks.filter((t) => t.status === 'done');

  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const t = title.trim();
            if (!t) return;
            onAdd(t, setMinutes(setHours(addDays(new Date(), 1), 10), 0).toISOString());
            setTitle('');
          }}
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a task, due tomorrow 10 am"
            aria-label="New task"
            maxLength={200}
          />
          <Button size="md" type="submit" disabled={!title.trim()} aria-label="Add task">
            <Plus aria-hidden />
            <span className="hidden sm:inline">Add</span>
          </Button>
        </form>
      )}
      {tasks.length === 0 && (
        <p className="py-4 text-center text-sm text-muted">No tasks for this lead.</p>
      )}
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {[...open, ...done].map((t) => {
          const overdue = t.status === 'open' && isOverdue(t.dueAt);
          const isDone = t.status === 'done';
          return (
            <li key={t.id} className="flex items-start gap-3 px-3 py-2.5">
              <Checkbox
                className="mt-0.5"
                checked={isDone}
                disabled={!canEdit}
                onCheckedChange={(c) => onToggle(t, c === true)}
                aria-label={isDone ? `Reopen task: ${t.title}` : `Complete task: ${t.title}`}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className={cn('text-sm', isDone ? 'text-muted line-through' : 'text-fg')}>
                  {t.title}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {t.dueAt && (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1',
                        overdue ? 'font-medium text-danger-text' : 'text-muted',
                      )}
                    >
                      {overdue && <AlarmClock aria-hidden className="size-3.5" />}
                      {overdue ? 'Overdue · ' : 'Due '}
                      {formatFollowUp(t.dueAt)}
                    </span>
                  )}
                  {t.priority !== 'normal' && (
                    <Chip tone={PRIORITY_TONE[t.priority]}>
                      {t.priority[0]!.toUpperCase() + t.priority.slice(1)}
                    </Chip>
                  )}
                  {t.source === 'workflow' && (
                    <span className="inline-flex items-center gap-1 text-muted">
                      <Workflow aria-hidden className="size-3" /> From workflow
                    </span>
                  )}
                </div>
              </div>
              {t.assignee && <Avatar name={t.assignee.name} size="xs" title={t.assignee.name} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
