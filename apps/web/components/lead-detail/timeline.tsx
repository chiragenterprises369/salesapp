'use client';

import {
  formatDuration,
  labelOf,
  NoteCreateSchema,
  type Activity,
  type WorkflowStepStatus,
} from '@vistar/shared';
import { mockUsers } from '@vistar/shared/fixtures';
import { format, isToday, isYesterday } from 'date-fns';
import {
  ArrowRightLeft,
  CheckCircle2,
  FileUp,
  GitMerge,
  ListTodo,
  Mail,
  MessageCircle,
  PenLine,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Play,
  Sparkles,
  StickyNote,
  UserRoundPlus,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { ToggleGroup } from 'radix-ui';
import { useMemo, useState, type ReactNode, type Ref } from 'react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Textarea } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { SOURCE_LABEL } from '@/components/leads/lead-meta';
import { usePipelineStages } from '@/components/leads/use-stages';
import { useLabels } from '@/lib/customization';
import type { LeadSource } from '@vistar/shared';

const USERS = new Map(mockUsers().map((u) => [u.id, u.name]));

type Filter = 'all' | 'calls' | 'messages' | 'notes' | 'system';
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'calls', label: 'Calls' },
  { id: 'messages', label: 'WhatsApp' },
  { id: 'notes', label: 'Notes' },
  { id: 'system', label: 'Changes' },
];

function matches(a: Activity, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'calls') return a.type === 'call';
  if (f === 'messages') return a.type === 'message' || a.type === 'email';
  if (f === 'notes') return a.type === 'note';
  return !['call', 'message', 'email', 'note'].includes(a.type);
}

const STEP_TONE: Record<WorkflowStepStatus, 'green' | 'red' | 'grey' | 'blue' | 'amber'> = {
  succeeded: 'green',
  failed: 'red',
  skipped: 'grey',
  pending: 'grey',
  running: 'blue',
  waiting: 'amber',
};
const STEP_LABEL: Record<WorkflowStepStatus, string> = {
  succeeded: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  pending: 'Pending',
  running: 'Running',
  waiting: 'Waiting',
};

function dayLabel(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEE, d MMM yyyy');
}

/** Placeholder bars until recordings stream from telephony (deterministic per call). */
function Waveform({ seed }: { seed: string }) {
  const bars = useMemo(() => {
    let h = 0;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return Array.from(
      { length: 48 },
      (_, i) => 0.2 + (Math.abs((h >>> (i % 24)) ^ (i * 7)) % 10) / 12,
    );
  }, [seed]);
  return (
    <span aria-hidden className="flex h-6 min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
      {bars.map((b, i) => (
        <span
          key={i}
          className="w-[3px] shrink-0 rounded-full bg-muted opacity-50"
          style={{ height: `${Math.min(1, b) * 100}%` }}
        />
      ))}
    </span>
  );
}

interface DescribeContext {
  stageName: (id: string) => string | undefined;
  /** Configured singular label for leads ("Lead", "Enquiry"). */
  lead: string;
  leads: string;
}

function describe(
  a: Activity,
  ctx: DescribeContext,
): {
  icon: LucideIcon;
  title: ReactNode;
  body?: ReactNode;
  tone?: string;
} {
  const who = a.actor?.name ?? 'Vistar';
  switch (a.type) {
    case 'lead_created':
      return {
        icon: Sparkles,
        title: `${ctx.lead} created from ${SOURCE_LABEL[a.payload.source as LeadSource] ?? a.payload.source}`,
      };
    case 'note':
      return {
        icon: StickyNote,
        title: `${who} added a note`,
        body: (
          <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap text-fg">
            {a.payload.body}
          </p>
        ),
      };
    case 'call': {
      const missed = a.payload.status === 'missed';
      const outcome = a.payload.outcome ? a.payload.outcome.replace(/_/g, ' ') : null;
      return {
        icon: missed ? PhoneMissed : a.actor ? PhoneOutgoing : PhoneIncoming,
        tone: missed ? 'text-danger-text' : undefined,
        title: missed
          ? `Missed call${a.actor ? ` by ${who}` : ''}`
          : `${who} called · ${formatDuration(a.payload.durationSec)}${outcome ? ` · ${outcome}` : ''}`,
        body: a.payload.hasRecording ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5">
            <Button
              size="icon-sm"
              variant="ghost"
              disabled
              aria-label="Play recording (available once telephony is connected)"
            >
              <Play aria-hidden />
            </Button>
            <Waveform seed={a.payload.callId} />
            <span className="tabular text-2xs text-muted">
              {formatDuration(a.payload.durationSec)}
            </span>
          </div>
        ) : undefined,
      };
    }
    case 'message': {
      const out = a.payload.direction === 'outbound';
      return {
        icon: MessageCircle,
        title: out ? 'WhatsApp sent' : 'WhatsApp received',
        body: (
          <p
            className={cn(
              'max-w-[85%] rounded-lg px-3 py-2 text-sm text-fg',
              out
                ? 'ml-auto rounded-tr-xs border border-status-green-border bg-status-green-bg'
                : 'rounded-tl-xs border border-border bg-surface-2',
            )}
          >
            {a.payload.preview}
          </p>
        ),
      };
    }
    case 'email':
      return {
        icon: Mail,
        title: `${a.payload.direction === 'outbound' ? 'Email sent' : 'Email received'}: ${a.payload.subject}`,
      };
    case 'stage_changed': {
      const from = a.payload.fromStageId ? ctx.stageName(a.payload.fromStageId) : null;
      const to = ctx.stageName(a.payload.toStageId) ?? 'a new stage';
      return {
        icon: ArrowRightLeft,
        title: from
          ? `${who} moved the ${ctx.lead.toLowerCase()} from ${from} to ${to}`
          : `${who} moved the ${ctx.lead.toLowerCase()} to ${to}`,
      };
    }
    case 'assigned': {
      const to = a.payload.toUserId ? (USERS.get(a.payload.toUserId) ?? 'a teammate') : 'nobody';
      const rule = a.payload.rule ? ` (${a.payload.rule.replace(/_/g, ' ')})` : '';
      return { icon: UserRoundPlus, title: `Assigned to ${to}${rule}` };
    }
    case 'task_created':
      return { icon: ListTodo, title: `Task created: ${a.payload.title}` };
    case 'task_completed':
      return { icon: CheckCircle2, title: `${who} completed: ${a.payload.title}` };
    case 'workflow_step':
      return {
        icon: Workflow,
        title: (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {a.payload.workflowName}: {a.payload.summary}
            <Chip tone={STEP_TONE[a.payload.status]}>{STEP_LABEL[a.payload.status]}</Chip>
          </span>
        ),
      };
    case 'file_uploaded':
      return { icon: FileUp, title: `${who} uploaded ${a.payload.name}` };
    case 'field_updated':
      return { icon: PenLine, title: `${who} changed ${a.payload.field}` };
    case 'merged':
      return {
        icon: GitMerge,
        title: `${who} merged ${a.payload.mergedLeadIds.length} duplicate ${a.payload.mergedLeadIds.length === 1 ? ctx.lead.toLowerCase() : ctx.leads.toLowerCase()} into this one`,
      };
  }
}

export interface TimelineProps {
  activities: Activity[];
  canAddNote: boolean;
  onAddNote: (body: string) => void;
  composerRef?: Ref<HTMLTextAreaElement>;
}

/** Unified lead timeline (calls, WhatsApp, notes, stage changes, workflow steps) with a note composer. */
export function Timeline({ activities, canAddNote, onAddNote, composerRef }: TimelineProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const { byId } = usePipelineStages();
  const labels = useLabels();
  const ctx: DescribeContext = {
    stageName: (id) => byId.get(id)?.name,
    lead: labelOf(labels, 'lead'),
    leads: labelOf(labels, 'lead', { plural: true }),
  };
  const visible = activities.filter((a) => matches(a, filter));
  const groups = useMemo(() => {
    const out: Array<{ day: string; items: Activity[] }> = [];
    for (const a of visible) {
      const day = dayLabel(a.createdAt);
      const last = out.at(-1);
      if (last?.day === day) last.items.push(a);
      else out.push({ day, items: [a] });
    }
    return out;
  }, [visible]);

  const submit = () => {
    const parsed = NoteCreateSchema.safeParse({ body: note });
    if (!parsed.success) return setError('Write something before adding the note');
    onAddNote(parsed.data.body);
    setNote('');
    setError(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {canAddNote && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="lead-note" className="sr-only">
            Add a note
          </label>
          <Textarea
            id="lead-note"
            ref={composerRef}
            value={note}
            placeholder="Add a note: what did the customer ask for?"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'lead-note-error' : undefined}
            onChange={(e) => {
              setNote(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            className="min-h-16"
          />
          <div className="flex items-center justify-between gap-2">
            {error ? (
              <p id="lead-note-error" role="alert" className="text-xs text-danger-text">
                {error}
              </p>
            ) : (
              <p className="text-xs text-muted">Ctrl + Enter to add</p>
            )}
            <Button size="sm" type="submit" disabled={!note.trim()}>
              Add note
            </Button>
          </div>
        </form>
      )}

      <ToggleGroup.Root
        type="single"
        value={filter}
        onValueChange={(v) => v && setFilter(v as Filter)}
        aria-label="Show activity"
        className="flex flex-wrap gap-1"
      >
        {FILTERS.map((f) => (
          <ToggleGroup.Item
            key={f.id}
            value={f.id}
            className="focus-ring h-7 rounded-full border border-border px-2.5 text-xs font-medium text-fg-secondary transition-colors hover:bg-surface-2 data-[state=on]:border-status-indigo-border data-[state=on]:bg-accent-soft data-[state=on]:text-accent-soft-fg"
          >
            {f.label}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>

      {groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Nothing here yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.day} aria-label={g.day}>
              <h4 className="mb-2 text-2xs font-medium tracking-wide text-muted uppercase">
                {g.day}
              </h4>
              <ol className="relative flex flex-col gap-3 before:absolute before:top-2 before:bottom-2 before:left-[13px] before:w-px before:bg-border">
                <AnimatePresence initial={false}>
                  {g.items.map((a) => {
                    const d = describe(a, ctx);
                    const Icon = d.icon;
                    return (
                      <motion.li
                        key={a.id}
                        layout={reduced ? false : 'position'}
                        initial={reduced ? false : { opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                        className="relative flex gap-3"
                      >
                        <span
                          className={cn(
                            'relative z-[1] inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted-strong',
                            d.tone,
                          )}
                        >
                          <Icon aria-hidden className="size-3.5" />
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="min-w-0 text-sm text-fg">{d.title}</p>
                            <time
                              dateTime={a.createdAt}
                              className="tabular shrink-0 text-2xs text-muted"
                            >
                              {format(new Date(a.createdAt), 'h:mm a')}
                            </time>
                          </div>
                          {d.body}
                        </div>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
