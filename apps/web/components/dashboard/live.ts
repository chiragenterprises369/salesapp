import {
  formatDuration,
  type AttentionItem,
  type DashboardSummary,
  type DomainEvent,
  type FeedItem,
  type Kpi,
} from '@vistar/shared';

/**
 * Applies realtime events to the dashboard summary (pure). Wave 1 feeds createEventSimulator();
 * Wave 3 feeds the socket stream with the same function. Events outside the caller's scope are
 * ignored (`visible` = user ids in scope, null = whole workspace).
 */
export interface LiveState {
  summary: DashboardSummary;
  /** Answered / total calls counters behind answeredPct. */
  calls: { answered: number; total: number };
  /** Ids of feed items that arrived live (slide-in highlight). */
  fresh: ReadonlySet<string>;
}

export function initLive(summary: DashboardSummary): LiveState {
  const total = summary.kpis.callsToday.value;
  return {
    summary,
    calls: { answered: Math.round((summary.kpis.answeredPct.value / 100) * total), total },
    fresh: new Set(),
  };
}

const bump = (k: Kpi, by = 1): Kpi => {
  const sparkline = k.sparkline.length
    ? [...k.sparkline.slice(0, -1), (k.sparkline.at(-1) ?? 0) + by]
    : [k.value + by];
  return { ...k, value: k.value + by, sparkline };
};
const setValue = (k: Kpi, value: number): Kpi => ({
  ...k,
  value,
  sparkline: [...k.sparkline.slice(0, -1), value],
});
const first = (name: string | undefined | null) => (name ?? 'Someone').split(' ')[0];

const FEED_MAX = 14;
const ATTENTION_MAX = 12;

export function applyEvents(
  state: LiveState,
  events: DomainEvent[],
  visible: Set<string> | null,
): LiveState {
  if (events.length === 0) return state;
  let { summary, calls } = state;
  const feed: FeedItem[] = [];
  let attention = summary.attention;
  const inScope = (userId: string | null | undefined) =>
    visible === null || (!!userId && visible.has(userId));
  const hour = new Date().getHours();

  for (const e of events) {
    switch (e.type) {
      case 'lead.created': {
        if (visible !== null) break;
        const { lead } = (e as DomainEvent<'lead.created'>).payload;
        summary = { ...summary, kpis: { ...summary.kpis, newLeads: bump(summary.kpis.newLeads) } };
        feed.push({
          id: e.id,
          kind: 'lead_created',
          text: `New ${lead.source === 'indiamart' ? 'IndiaMART' : lead.source} lead: ${lead.name}${lead.city ? ` from ${lead.city}` : ''}`,
          actor: null,
          leadId: lead.id,
          createdAt: e.occurredAt,
        });
        if (lead.temperature === 'hot') {
          const item: AttentionItem = {
            id: `hot_lead_unassigned:${lead.id}`,
            kind: 'hot_lead_unassigned',
            title: `${lead.name} is hot and unassigned`,
            subtitle: `${lead.companyName ?? 'No company'} · score ${lead.score}`,
            href: null,
            leadId: lead.id,
            userId: null,
            severity: 'critical',
            createdAt: e.occurredAt,
          };
          attention = [item, ...attention].slice(0, ATTENTION_MAX);
        }
        break;
      }
      case 'lead.assigned': {
        const p = (e as DomainEvent<'lead.assigned'>).payload;
        attention = attention.filter((a) => a.id !== `hot_lead_unassigned:${p.lead.id}`);
        if (!inScope(p.toUserId)) break;
        if (visible !== null)
          summary = {
            ...summary,
            kpis: { ...summary.kpis, newLeads: bump(summary.kpis.newLeads) },
          };
        feed.push({
          id: e.id,
          kind: 'lead_assigned',
          text: `${p.lead.name} assigned to ${p.lead.owner?.name ?? 'a teammate'}${p.rule ? ` (${p.rule.replace(/_/g, ' ')})` : ''}`,
          actor: p.lead.owner,
          leadId: p.lead.id,
          createdAt: e.occurredAt,
        });
        break;
      }
      case 'call.started': {
        const { call } = (e as DomainEvent<'call.started'>).payload;
        if (!inScope(call.user?.id)) break;
        summary = {
          ...summary,
          kpis: { ...summary.kpis, callsToday: bump(summary.kpis.callsToday) },
          leaderboard: summary.leaderboard.map((l) =>
            l.user.id === call.user?.id ? { ...l, calls: l.calls + 1 } : l,
          ),
        };
        calls = { ...calls, total: calls.total + 1 };
        break;
      }
      case 'call.ended': {
        const { call } = (e as DomainEvent<'call.ended'>).payload;
        if (!inScope(call.user?.id)) break;
        const ok = call.status === 'completed';
        calls = { ...calls, answered: calls.answered + (ok ? 1 : 0) };
        const pct = calls.total ? Math.round((calls.answered / calls.total) * 100) : 0;
        summary = {
          ...summary,
          kpis: { ...summary.kpis, answeredPct: setValue(summary.kpis.answeredPct, pct) },
          callsPerHour: summary.callsPerHour.map((h) =>
            h.hour === hour
              ? { ...h, answered: h.answered + (ok ? 1 : 0), missed: h.missed + (ok ? 0 : 1) }
              : h,
          ),
        };
        feed.push({
          id: e.id,
          kind: 'call_ended',
          text: ok
            ? `${first(call.user?.name)} finished a ${formatDuration(call.durationSec)} call with ${call.leadName ?? 'a lead'}${call.outcome && call.outcome !== 'answered' ? ` (${call.outcome.replace(/_/g, ' ')})` : ''}`
            : `${first(call.user?.name)} missed a call with ${call.leadName ?? 'a lead'}`,
          actor: call.user,
          leadId: call.leadId,
          createdAt: e.occurredAt,
        });
        break;
      }
      case 'task.overdue': {
        const { task } = (e as DomainEvent<'task.overdue'>).payload;
        if (!inScope(task.assignee?.id)) break;
        const item: AttentionItem = {
          id: `task_overdue:${task.id}`,
          kind: 'task_overdue',
          title: `Overdue: ${task.title}`,
          subtitle: task.assignee ? `Assigned to ${task.assignee.name}` : null,
          href: null,
          leadId: task.leadId,
          userId: task.assignee?.id ?? null,
          severity: 'warning',
          createdAt: e.occurredAt,
        };
        attention = [item, ...attention.filter((a) => a.id !== item.id)].slice(0, ATTENTION_MAX);
        break;
      }
      default:
        break;
    }
  }

  if (feed.length === 0 && attention === summary.attention) return { ...state, summary, calls };
  const fresh = new Set(feed.map((f) => f.id));
  return {
    summary: {
      ...summary,
      attention,
      feed: [...feed.reverse(), ...summary.feed].slice(0, FEED_MAX),
    },
    calls,
    fresh,
  };
}
