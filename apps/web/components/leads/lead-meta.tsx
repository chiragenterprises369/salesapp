'use client';

import {
  stageTone,
  type ChipTone,
  type LeadSource,
  type LeadTemperature,
  type MeResponse,
  type UserSummary,
} from '@vistar/shared';
import { mockUsers, TAGS } from '@vistar/shared/fixtures';
import {
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
  isToday,
  isTomorrow,
  isYesterday,
} from 'date-fns';
import {
  Code2,
  FileUp,
  Flame,
  Globe,
  MessageCircle,
  PenLine,
  Snowflake,
  Sun,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/cn';
import { useMe } from '@/lib/session/session';
import { usePipelineStages } from './use-stages';

/** Static default stages: FALLBACK ONLY (see ./use-stages). Read stages with `usePipelineStages()`. */
export { FALLBACK_PIPELINE, FALLBACK_STAGES } from './use-stages';
export const KNOWN_TAGS: readonly string[] = TAGS;

export const SOURCE_LABEL: Record<LeadSource, string> = {
  indiamart: 'IndiaMART',
  website: 'Website',
  whatsapp: 'WhatsApp',
  manual: 'Manual',
  webhook: 'Webhook',
  import: 'Import',
  api: 'API',
};

const SOURCE_ICON: Record<LeadSource, LucideIcon> = {
  indiamart: Globe,
  website: Globe,
  whatsapp: MessageCircle,
  manual: PenLine,
  webhook: Webhook,
  import: FileUp,
  api: Code2,
};

/** Dot colour per chip tone (static class names so Tailwind can see them). */
export const TONE_DOT_CLASS: Record<ChipTone, string> = {
  neutral: 'bg-muted',
  indigo: 'bg-status-indigo-fg',
  blue: 'bg-status-blue-fg',
  green: 'bg-status-green-fg',
  amber: 'bg-status-amber-fg',
  grey: 'bg-status-grey-fg',
  red: 'bg-status-red-fg',
};

/** Toolbar buttons with an active filter (selection state, accent-soft). */
export const ACTIVE_FILTER_CLASS =
  'border-status-indigo-border bg-accent-soft text-accent-soft-fg hover:bg-accent-soft';

export const TEMPERATURE_LABEL: Record<LeadTemperature, string> = {
  hot: 'Hot',
  warm: 'Warm',
  cold: 'Cold',
};
export const TEMPERATURE_TONE: Record<LeadTemperature, ChipTone> = {
  hot: 'red',
  warm: 'amber',
  cold: 'blue',
};
const TEMPERATURE_ICON: Record<LeadTemperature, LucideIcon> = {
  hot: Flame,
  warm: Sun,
  cold: Snowflake,
};

export function SourceChip({ source, className }: { source: LeadSource; className?: string }) {
  const Icon = SOURCE_ICON[source];
  return (
    <Chip className={className}>
      <Icon aria-hidden />
      {SOURCE_LABEL[source]}
    </Chip>
  );
}

export function TemperatureChip({
  temperature,
  className,
}: {
  temperature: LeadTemperature;
  className?: string;
}) {
  const Icon = TEMPERATURE_ICON[temperature];
  return (
    <Chip tone={TEMPERATURE_TONE[temperature]} className={className}>
      <Icon aria-hidden />
      {TEMPERATURE_LABEL[temperature]}
    </Chip>
  );
}

export function StageChip({ stageId, className }: { stageId: string; className?: string }) {
  const { byId } = usePipelineStages();
  const stage = byId.get(stageId);
  if (!stage) return <Chip className={className}>Unknown stage</Chip>;
  return (
    <Chip tone={stageTone(stage)} dot className={className}>
      {stage.name}
    </Chip>
  );
}

export function TagList({
  tags,
  max = 2,
  className,
}: {
  tags: readonly string[];
  max?: number;
  className?: string;
}) {
  if (tags.length === 0) return <span className="text-muted">—</span>;
  const shown = tags.slice(0, max);
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      {shown.map((t) => (
        <Chip key={t} tone="neutral">
          {t}
        </Chip>
      ))}
      {tags.length > max && <span className="text-xs text-muted">+{tags.length - max}</span>}
    </span>
  );
}

/** Users the signed-in person can see (owner filters and pickers). Mirrors GET /users/options scope. */
export function scopedUsers(me: MeResponse | null): UserSummary[] {
  const all = mockUsers().filter((u) => u.role !== 'viewer');
  if (!me) return [];
  if (me.role.dataScope === 'all') return all;
  if (me.role.dataScope === 'own') return all.filter((u) => u.id === me.user.id);
  const visible = new Set([me.user.id, ...me.teamMemberIds]);
  return all.filter((u) => visible.has(u.id));
}

export function useScopedUsers(): UserSummary[] {
  const me = useMe();
  return useMemo(() => scopedUsers(me), [me]);
}

/** "Today 4:30 pm", "Tomorrow", "In 3 days", "2 days ago". */
export function formatFollowUp(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (isToday(d)) return `Today ${format(d, 'h:mm a')}`;
  if (isTomorrow(d)) return `Tomorrow ${format(d, 'h:mm a')}`;
  if (isYesterday(d)) return 'Yesterday';
  const days = differenceInCalendarDays(d, now);
  if (days > 0 && days < 7) return `In ${days} days`;
  if (days < 0 && days > -7) return `${-days} days ago`;
  return format(d, 'd MMM');
}

export function isOverdue(iso: string | null, now = Date.now()): boolean {
  return !!iso && new Date(iso).getTime() < now;
}

export function formatCreated(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'h:mm a');
  return format(d, 'd MMM yyyy');
}

export function timeAgo(iso: string): string {
  const d = new Date(iso);
  // Clock skew between devices can put a timestamp slightly in the future.
  if (d.getTime() > Date.now()) return 'Just now';
  return formatDistanceToNowStrict(d, { addSuffix: true });
}

/** First name for templates ("Rakesh Sharma" -> "Rakesh"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** +919876543210 -> +91 98765 43210 */
export function formatPhone(e164: string | null): string {
  if (!e164) return '—';
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}
