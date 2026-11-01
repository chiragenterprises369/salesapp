'use client';

import type { Lead, LeadListItem, LeadUpdate, Stage, Task } from '@vistar/shared';
import { mockUsers } from '@vistar/shared/fixtures';
import {
  AlarmClock,
  ChevronDown,
  Copy,
  ExternalLink,
  GitMerge,
  Mail,
  MapPin,
  MoreHorizontal,
  Phone,
  Play,
  UserRoundX,
} from 'lucide-react';
import Link from 'next/link';
import { Tabs } from 'radix-ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LeadQuickActions } from '@/components/leads-shared/lead-actions';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { useLead, useUpdateLead } from '@/lib/leads/data';
import { useCan, useMe } from '@/lib/session/session';
import { WidgetSlot } from '@/lib/packs';
import {
  formatCreated,
  formatFollowUp,
  formatPhone,
  isOverdue,
  SOURCE_LABEL,
  SourceChip,
  TemperatureChip,
  timeAgo,
  useScopedUsers,
} from '@/components/leads/lead-meta';
import { useLeadWords } from '@/components/leads/use-lead-words';
import { usePipelineStages } from '@/components/leads/use-stages';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/leads/primitives/menu';
import { EmptyState, ErrorState } from '@/components/leads/states';
import { actorFrom, useLocalActivity } from './activity-store';
import { DealValue } from './deal-value';
import { LeadCustomFields } from './lead-custom-fields';
import { MergeDialog, RunWorkflowDialog } from './lead-dialogs';
import { mockTasks, mockTimeline } from './mock-timeline';
import { ScoreBreakdown, ScoreRing } from './score-ring';
import { StageProgress } from './stage-progress';
import { TagsEditor } from './tags-editor';
import { TasksList } from './tasks-list';
import { Timeline } from './timeline';
import { useDrawerIntent } from './use-lead-drawer';

export type LeadPanel = 'company' | 'employee';
export const leadsBasePath = (panel: LeadPanel) =>
  panel === 'employee' ? '/me/leads' : '/app/leads';

function Section({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-2', className)} aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-fg-secondary">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border border-border bg-surface p-3">
      <span className="text-2xs font-medium tracking-wide text-muted uppercase">{label}</span>
      {children}
    </div>
  );
}

export interface LeadDetailProps {
  leadId: string;
  panel: LeadPanel;
  variant: 'drawer' | 'page';
  /** Drawer header slot (close button). */
  headerEnd?: ReactNode;
}

/** Lead detail content shared by the drawer (?lead=<id>) and the full page (/leads/[id]). */
export function LeadDetail({ leadId, panel, variant, headerEnd }: LeadDetailProps) {
  const query = useLead(leadId);
  const lead = query.data;
  const w = useLeadWords();

  if (query.isPending) return <LeadDetailSkeleton variant={variant} headerEnd={headerEnd} />;
  if (query.isError || !lead) {
    const notFound = query.error instanceof Error && /not found/i.test(query.error.message);
    return (
      <div className="flex flex-1 flex-col">
        {headerEnd && <div className="flex justify-end p-3">{headerEnd}</div>}
        {notFound ? (
          <EmptyState
            icon={<UserRoundX aria-hidden />}
            title={`This ${w.lead} is not available`}
            description="It may have been deleted or merged, or it belongs to someone outside your team."
            action={
              <Button asChild>
                <Link href={leadsBasePath(panel)}>Back to {w.leads}</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState
            title={`${w.Lead} did not load`}
            onRetry={() => void query.refetch()}
            retrying={query.isRefetching}
          />
        )}
      </div>
    );
  }
  return <LeadDetailBody lead={lead} panel={panel} variant={variant} headerEnd={headerEnd} />;
}

function LeadDetailBody({
  lead,
  panel,
  variant,
  headerEnd,
}: {
  lead: Lead;
  panel: LeadPanel;
  variant: 'drawer' | 'page';
  headerEnd?: ReactNode;
}) {
  const me = useMe();
  const users = useScopedUsers();
  const w = useLeadWords();
  const { byId } = usePipelineStages();
  const canUpdate = useCan('leads.update');
  const canAssign = useCan('leads.assign');
  const canMerge = useCan('leads.merge');
  const canRun = useCan('workflows.run');
  const update = useUpdateLead();
  const local = useLocalActivity();
  const focusNoteFor = useDrawerIntent((s) => s.focusNoteFor);
  const setFocusNote = useDrawerIntent((s) => s.setFocusNote);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<'timeline' | 'tasks'>('timeline');
  const [showScore, setShowScore] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [base, setBase] = useState<{ id: string; lead: Lead } | null>(null);
  const [now] = useState(() => Date.now());

  // Mock timeline/tasks are generated once per lead (later edits add local activities on top).
  if (base?.id !== lead.id) setBase({ id: lead.id, lead });
  const seed = base?.id === lead.id ? base.lead : lead;
  const allUsers = useMemo(() => mockUsers(), []);
  const activities = useMemo(
    () =>
      [...(local.activities[lead.id] ?? []), ...mockTimeline(seed, allUsers, now)].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1,
      ),
    [local.activities, lead.id, seed, allUsers, now],
  );
  const tasks = useMemo(
    () =>
      [...(local.tasks[lead.id] ?? []), ...mockTasks(seed, now)].map((t) =>
        local.done[t.id] === undefined
          ? t
          : { ...t, status: local.done[t.id] ? ('done' as const) : ('open' as const) },
      ),
    [local.tasks, local.done, lead.id, seed, now],
  );
  const openTasks = tasks.filter((t) => t.status === 'open').length;

  // "Add note" quick action: open on the timeline with the composer focused.
  useEffect(() => {
    if (focusNoteFor !== lead.id) return;
    const id = requestAnimationFrame(() => {
      composerRef.current?.focus();
      setFocusNote(null);
    });
    return () => cancelAnimationFrame(id);
  }, [focusNoteFor, lead.id, setFocusNote]);

  const actor = actorFrom(me?.user ?? null);
  const save = async (patch: LeadUpdate, message: string) => {
    try {
      await update.mutateAsync({ id: lead.id, patch });
      toast.success(message);
    } catch (e) {
      toast.error('Change not saved. Check your connection and try again.');
      throw e;
    }
  };

  const moveTo = async (stage: Stage) => {
    const from = lead.stageId;
    await save({ stageId: stage.id }, `${lead.name} moved to ${stage.name}`);
    local.add(lead.id, {
      type: 'stage_changed',
      actor,
      payload: { fromStageId: from, toStageId: stage.id },
    });
  };

  const assign = async (ownerId: string | null) => {
    const name = ownerId ? (users.find((u) => u.id === ownerId)?.name ?? 'teammate') : null;
    await save({ ownerId }, name ? `${w.Lead} assigned to ${name}` : `${w.Lead} unassigned`);
    local.add(lead.id, {
      type: 'assigned',
      actor,
      payload: { fromUserId: lead.owner?.id ?? null, toUserId: ownerId, rule: 'manual' },
    });
  };

  const copyLink = async () => {
    const url = `${window.location.origin}${leadsBasePath(panel)}/${lead.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error('Copy did not work. Select the address bar to copy the link.');
    }
  };

  const listItem: LeadListItem = lead;
  const stage = byId.get(lead.stageId);
  const overdue = isOverdue(lead.nextFollowUpAt);
  const isPage = variant === 'page';

  const header = (
    <header
      className={cn(
        'flex items-start gap-3',
        isPage ? 'pb-2' : 'border-b border-border px-5 pt-4 pb-4',
      )}
    >
      <Avatar name={lead.name} size="lg" aria-hidden />
      <div className="min-w-0 flex-1">
        {isPage ? (
          <h1 className="truncate text-xl font-semibold">{lead.name}</h1>
        ) : (
          <h2 className="truncate text-lg font-semibold">{lead.name}</h2>
        )}
        <p className="truncate text-sm text-muted">
          {[lead.companyName, lead.city].filter(Boolean).join(' · ') || 'No company'}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <TemperatureChip temperature={lead.temperature} />
          <SourceChip source={lead.source} />
          <span className="text-xs text-muted">Created {formatCreated(lead.createdAt)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <LeadQuickActions lead={listItem} className="hidden sm:flex" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="More actions">
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {!isPage && (
              <DropdownMenuItem asChild>
                <Link href={`${leadsBasePath(panel)}/${lead.id}`}>
                  <ExternalLink aria-hidden />
                  Open full page
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => void copyLink()}>
              <Copy aria-hidden />
              Copy link
            </DropdownMenuItem>
            {(canRun || canMerge) && <DropdownMenuSeparator />}
            {canRun && (
              <DropdownMenuItem onSelect={() => setRunOpen(true)}>
                <Play aria-hidden />
                Run workflow…
              </DropdownMenuItem>
            )}
            {canMerge && (
              <DropdownMenuItem onSelect={() => setMergeOpen(true)}>
                <GitMerge aria-hidden />
                Merge duplicates…
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {headerEnd}
      </div>
    </header>
  );

  const profile = (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Deal value">
          <DealValue
            value={lead.valueInr}
            editable={canUpdate}
            onSave={(v) => save({ valueInr: v }, 'Deal value updated')}
          />
        </Stat>
        <Stat label="Score">
          <div className="flex items-center gap-3">
            <ScoreRing score={lead.score} temperature={lead.temperature} size={44} />
            <Button
              size="sm"
              variant="link"
              aria-expanded={showScore}
              aria-controls={`score-${lead.id}`}
              onClick={() => setShowScore((s) => !s)}
            >
              {showScore ? 'Hide details' : 'How it is scored'}
            </Button>
          </div>
        </Stat>
        <Stat label="Owner">
          {canAssign ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="-mx-2 justify-start gap-2 px-2"
                  aria-label={`Owner: ${lead.owner?.name ?? 'Unassigned'}. Reassign`}
                >
                  {lead.owner ? <Avatar name={lead.owner.name} size="xs" aria-hidden /> : null}
                  <span className="truncate">{lead.owner?.name ?? 'Unassigned'}</span>
                  <ChevronDown aria-hidden className="text-muted" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuLabel>Reassign to</DropdownMenuLabel>
                {users.map((u) => (
                  <DropdownMenuItem
                    key={u.id}
                    disabled={u.id === lead.owner?.id}
                    onSelect={() => void assign(u.id).catch(() => undefined)}
                  >
                    <Avatar name={u.name} size="xs" status={u.status} aria-hidden />
                    <span className="truncate">
                      {u.id === me?.user.id ? `${u.name} (you)` : u.name}
                    </span>
                  </DropdownMenuItem>
                ))}
                {lead.owner && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void assign(null).catch(() => undefined)}>
                      Unassign
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="flex items-center gap-2 text-sm">
              {lead.owner && <Avatar name={lead.owner.name} size="xs" aria-hidden />}
              {lead.owner?.name ?? 'Unassigned'}
            </span>
          )}
        </Stat>
        <Stat label="Next follow-up">
          {lead.nextFollowUpAt ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-sm',
                overdue ? 'font-medium text-danger-text' : 'text-fg',
              )}
            >
              {overdue && <AlarmClock aria-hidden className="size-4" />}
              {overdue && <span className="sr-only">Overdue: </span>}
              {formatFollowUp(lead.nextFollowUpAt)}
            </span>
          ) : (
            <span className="text-sm text-muted">Not scheduled</span>
          )}
        </Stat>
      </div>
      {showScore && (
        <div id={`score-${lead.id}`} className="rounded-md border border-border bg-surface-2 p-3">
          <ScoreBreakdown breakdown={lead.scoreBreakdown} />
        </div>
      )}

      <Section title="Contact">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="flex items-center gap-1.5 text-muted">
            <Phone aria-hidden className="size-3.5" /> Phone
          </dt>
          <dd className="tabular truncate">
            {lead.phone ? (
              <a
                className="focus-ring rounded-xs text-accent-text hover:underline"
                href={`tel:${lead.phone}`}
              >
                {formatPhone(lead.phone)}
              </a>
            ) : (
              '—'
            )}
          </dd>
          <dt className="flex items-center gap-1.5 text-muted">
            <Mail aria-hidden className="size-3.5" /> Email
          </dt>
          <dd className="truncate">
            {lead.email ? (
              <a
                className="focus-ring rounded-xs text-accent-text hover:underline"
                href={`mailto:${lead.email}`}
              >
                {lead.email}
              </a>
            ) : (
              '—'
            )}
          </dd>
          <dt className="flex items-center gap-1.5 text-muted">
            <MapPin aria-hidden className="size-3.5" /> City
          </dt>
          <dd className="truncate">{[lead.city, lead.state].filter(Boolean).join(', ') || '—'}</dd>
          <dt className="text-muted">Source</dt>
          <dd className="truncate">
            {SOURCE_LABEL[lead.source]}
            {lead.sourceRef && <span className="text-muted"> · {lead.sourceRef}</span>}
          </dd>
          <dt className="text-muted">Last activity</dt>
          <dd className="truncate">{lead.lastActivityAt ? timeAgo(lead.lastActivityAt) : '—'}</dd>
        </dl>
      </Section>

      {lead.requirement && (
        <Section title="Requirement">
          <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg">
            {lead.requirement}
          </p>
        </Section>
      )}

      <Section title="Tags">
        <TagsEditor
          tags={lead.tags}
          editable={canUpdate}
          onChange={(tags) => save({ tags }, 'Tags updated').catch(() => undefined)}
        />
      </Section>

      <LeadCustomFields lead={lead} />

      <WidgetSlot slot="lead.detail" />
    </div>
  );

  const activity = (
    <Tabs.Root
      value={tab}
      onValueChange={(v) => setTab(v as 'timeline' | 'tasks')}
      className="flex flex-col gap-3"
    >
      <Tabs.List aria-label={`${w.Lead} activity`} className="flex gap-4 border-b border-border">
        {(
          [
            ['timeline', 'Timeline'],
            ['tasks', `Tasks${openTasks ? ` (${openTasks})` : ''}`],
          ] as const
        ).map(([id, label]) => (
          <Tabs.Trigger
            key={id}
            value={id}
            className="focus-ring -mb-px border-b-2 border-transparent px-0.5 pb-2 text-sm font-medium text-muted transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg"
          >
            {label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value="timeline" className="outline-none">
        <Timeline
          activities={activities}
          canAddNote={canUpdate}
          composerRef={composerRef}
          onAddNote={(body) => {
            local.add(lead.id, { type: 'note', actor, payload: { body } });
            toast.success('Note added');
          }}
        />
      </Tabs.Content>
      <Tabs.Content value="tasks" className="outline-none">
        <TasksList
          tasks={tasks}
          canEdit={canUpdate}
          onToggle={(t: Task, done) => {
            local.setDone(t.id, done);
            if (done)
              local.add(lead.id, {
                type: 'task_completed',
                actor,
                payload: { taskId: t.id, title: t.title },
              });
          }}
          onAdd={(title, dueAt) => {
            const id = crypto.randomUUID();
            const nowIso = new Date().toISOString();
            local.addTask(lead.id, {
              id,
              type: 'todo',
              title,
              notes: null,
              status: 'open',
              priority: 'normal',
              leadId: lead.id,
              leadName: lead.name,
              assignee: actor,
              dueAt,
              remindAt: null,
              snoozedUntil: null,
              completedAt: null,
              source: 'manual',
              workflowRunId: null,
              customFields: {},
              createdAt: nowIso,
              updatedAt: nowIso,
            });
            local.add(lead.id, { type: 'task_created', actor, payload: { taskId: id, title } });
            toast.success('Task added');
          }}
        />
      </Tabs.Content>
    </Tabs.Root>
  );

  const stageBlock = (
    <Section title={stage ? `Stage · ${stage.name}` : 'Stage'}>
      <StageProgress
        lead={lead}
        disabled={!canUpdate || update.isPending}
        onMove={(s) => moveTo(s).catch(() => undefined)}
      />
    </Section>
  );

  const dialogs = (
    <>
      {canRun && (
        <RunWorkflowDialog
          lead={lead}
          open={runOpen}
          onOpenChange={setRunOpen}
          onStarted={(name) =>
            local.add(lead.id, {
              type: 'workflow_step',
              actor: null,
              payload: {
                workflowId: crypto.randomUUID(),
                workflowName: name,
                runId: crypto.randomUUID(),
                nodeId: 'trigger',
                nodeType: 'trigger.manual',
                status: 'running',
                summary: `Started by ${me?.user.name ?? 'you'}`,
              },
            })
          }
        />
      )}
      {canMerge && (
        <MergeDialog
          lead={lead}
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          onMerged={(ids) =>
            local.add(lead.id, { type: 'merged', actor, payload: { mergedLeadIds: ids } })
          }
        />
      )}
    </>
  );

  if (isPage) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div className="lg:hidden">{stageBlock}</div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <div className="flex flex-col gap-5">{profile}</div>
          <div className="flex min-w-0 flex-col gap-5 rounded-lg border border-border bg-surface p-4 shadow-card">
            <div className="hidden lg:block">{stageBlock}</div>
            {activity}
          </div>
        </div>
        {dialogs}
      </div>
    );
  }

  return (
    <>
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
        <LeadQuickActions lead={listItem} size="touch" className="-my-1 sm:hidden" />
        {stageBlock}
        {profile}
        {activity}
      </div>
      {dialogs}
    </>
  );
}

function LeadDetailSkeleton({
  variant,
  headerEnd,
}: {
  variant: 'drawer' | 'page';
  headerEnd?: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className={cn('flex flex-col gap-5', variant === 'drawer' && 'px-5 py-4')}
    >
      <div className="flex items-start gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-5 w-40" />
        </div>
        {headerEnd}
      </div>
      <Skeleton className="h-8 w-full" />
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
