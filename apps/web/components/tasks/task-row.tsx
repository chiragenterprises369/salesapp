'use client';

import type { ChipTone, Task } from '@vistar/shared';
import { AlarmClock, CalendarClock, Check, MoreHorizontal, RotateCcw, Workflow } from 'lucide-react';
import Link from 'next/link';
import { formatDateTimeIn, formatTimeIn } from '@/components/common/time';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/common/menu';
import { TOUCH } from '@/components/reports/page-kit';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/cn';
import { dueState, snoozeOptions } from './logic';

export const TASK_TYPE_LABEL: Record<Task['type'], string> = { todo: 'To-do', call: 'Call', follow_up: 'Follow-up', meeting: 'Meeting', email: 'Email' };
const PRIORITY: Record<Task['priority'], { label: string; tone: ChipTone } | null> = {
  low: null,
  normal: null,
  high: { label: 'High', tone: 'amber' },
  urgent: { label: 'Urgent', tone: 'red' },
};

export function DueLabel({ task, now, timeZone }: { task: Task; now: number; timeZone: string }) {
  if (task.status === 'done')
    return task.completedAt ? <Chip tone="green">Done {formatDateTimeIn(task.completedAt, timeZone)}</Chip> : <Chip tone="green">Done</Chip>;
  if (!task.dueAt) return <Chip>No due date</Chip>;
  const s = dueState(task, now);
  if (s === 'overdue') return <Chip tone="red">Overdue · {formatDateTimeIn(task.dueAt, timeZone)}</Chip>;
  if (s === 'today') return <Chip tone="amber">Today {formatTimeIn(task.dueAt, timeZone)}</Chip>;
  return (
    <Chip>
      {new Intl.DateTimeFormat('en-IN', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(task.dueAt))}
    </Chip>
  );
}

/** One task: complete checkbox, title, chips (type, workflow, priority, due), linked lead, owner, snooze menu. */
export function TaskRow({
  task,
  now,
  timeZone,
  leadsBase,
  showOwner,
  canEdit,
  onComplete,
  onReopen,
  onSnooze,
}: {
  task: Task;
  now: number;
  timeZone: string;
  leadsBase: string;
  showOwner: boolean;
  canEdit: boolean;
  onComplete: (t: Task) => void;
  onReopen: (t: Task) => void;
  onSnooze: (t: Task, until: number, label: string) => void;
}) {
  const done = task.status === 'done';
  const priority = PRIORITY[task.priority];
  const snoozed = !done && task.snoozedUntil && Date.parse(task.snoozedUntil) > now;
  return (
    <li
      data-task-row
      className="group/task flex min-h-14 items-start gap-2 border-b border-border px-2 py-2 transition-colors duration-150 last:border-b-0 hover:bg-surface-2 sm:px-3"
    >
      <span className="flex size-8 shrink-0 items-center justify-center pointer-coarse:size-11">
        <input
          type="checkbox"
          checked={done}
          disabled={!canEdit}
          onChange={() => (done ? onReopen(task) : onComplete(task))}
          aria-label={`${done ? 'Reopen' : 'Complete'}: ${task.title}`}
          className="focus-ring size-4 cursor-pointer accent-accent disabled:cursor-not-allowed pointer-coarse:size-5"
        />
      </span>
      <div className="min-w-0 flex-1 py-1">
        <p className={cn('text-sm font-medium', done ? 'text-muted-strong line-through' : 'text-fg')}>{task.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Chip>{TASK_TYPE_LABEL[task.type]}</Chip>
          {task.source === 'workflow' && (
            <Chip tone="indigo" title="Created by a workflow">
              <Workflow aria-hidden />
              Workflow
            </Chip>
          )}
          {priority && !done && <Chip tone={priority.tone}>{priority.label}</Chip>}
          <DueLabel task={task} now={now} timeZone={timeZone} />
          {snoozed && (
            <Chip tone="blue">
              <AlarmClock aria-hidden />
              Snoozed
            </Chip>
          )}
          {task.leadId && task.leadName && (
            <Link
              href={`${leadsBase}?lead=${task.leadId}`}
              className="focus-ring inline-flex items-center rounded-xs text-xs font-medium text-accent-text underline-offset-4 hover:underline pointer-coarse:min-h-11"
            >
              {task.leadName}
            </Link>
          )}
        </div>
        {task.notes && <p className="mt-1 line-clamp-1 text-xs text-muted">{task.notes}</p>}
      </div>
      {showOwner && task.assignee && (
        <span className="hidden w-36 shrink-0 items-center gap-2 py-1.5 md:flex">
          <Avatar name={task.assignee.name} size="sm" />
          <span className="truncate text-xs text-fg-secondary">{task.assignee.name}</span>
        </span>
      )}
      {canEdit && (
        <div className="flex shrink-0 items-center gap-0.5">
          {done ? (
            <Button variant="ghost" size="icon" className={TOUCH} aria-label={`Reopen: ${task.title}`} onClick={() => onReopen(task)}>
              <RotateCcw aria-hidden />
            </Button>
          ) : (
            <Button variant="ghost" size="icon" className={cn('hidden sm:inline-flex', TOUCH)} aria-label={`Complete: ${task.title}`} onClick={() => onComplete(task)}>
              <Check aria-hidden />
            </Button>
          )}
          {!done && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className={TOUCH} aria-label={`Snooze or more: ${task.title}`}>
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Snooze until</DropdownMenuLabel>
                {snoozeOptions(now).map((o) => (
                  <DropdownMenuItem key={o.key} onSelect={() => onSnooze(task, o.until, o.label)}>
                    <CalendarClock aria-hidden />
                    {o.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onComplete(task)}>
                  <Check aria-hidden />
                  Mark as done
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </li>
  );
}
