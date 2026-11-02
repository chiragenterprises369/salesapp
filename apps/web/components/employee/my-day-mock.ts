import type { Call, LeadListItem, MeResponse, MyToday, Task } from '@vistar/shared';
import { DAY_MS, istDayStart, istMonthStart, istPeriod, istWeekday, wonAt } from '@vistar/shared/fixtures';
import { currentMockLeads } from '@/lib/leads/mock-source';
import { listCalls, listTasks, targetsForUser, viewerFromMe } from '@/lib/world';
import { world, worldContext } from '@/lib/world/world';

/**
 * Employee panel data (Wave 1) from the mock world: the signed-in user's own tasks, calls, leads and
 * targets (own scope, like GET /me/today, GET /tasks?scope=mine and GET /calls?userId=me). Lead ids
 * are the Leads page ids, so every row opens the right lead.
 */
const MAX_PER_SECTION = 15;

export interface MyDay {
  today: MyToday;
  /** Phone numbers for leads referenced by tasks (tasks only carry leadId/leadName). */
  phones: Record<string, string | null>;
  /** Upcoming tasks after today (Tasks page). */
  later: Task[];
}

const byDue = (a: Task, b: Task) => Date.parse(a.dueAt ?? '') - Date.parse(b.dueAt ?? '');

export function buildMyDay(me: MeResponse, nowMs: number): MyDay {
  const ctx = worldContext();
  const v = viewerFromMe(me);
  const endOfDay = istDayStart(nowMs) + DAY_MS;
  const open = listTasks({ scope: 'mine', status: ['open'], limit: 5000 }, v, nowMs).items;
  const dueByToday = open.filter((t) => t.dueAt && Date.parse(t.dueAt) < endOfDay).sort(byDue);
  const callsToMake = dueByToday.filter((t) => t.type === 'call').slice(0, MAX_PER_SECTION);
  const tasksDue = dueByToday.filter((t) => t.type !== 'call').slice(0, MAX_PER_SECTION);
  const later = open
    .filter((t) => t.dueAt && Date.parse(t.dueAt) >= endOfDay && Date.parse(t.dueAt) < endOfDay + 7 * DAY_MS)
    .sort(byDue)
    .slice(0, MAX_PER_SECTION);

  const mine = currentMockLeads().filter((l) => l.owner?.id === me.user.id);
  const openStage = (l: LeadListItem) => ctx.stageById.get(l.stageId)?.type !== 'won' && ctx.stageById.get(l.stageId)?.type !== 'lost';
  const followUps = mine
    .filter((l) => openStage(l) && l.nextFollowUpAt && Date.parse(l.nextFollowUpAt) < endOfDay)
    .sort((a, b) => Date.parse(a.nextFollowUpAt!) - Date.parse(b.nextFollowUpAt!))
    .slice(0, MAX_PER_SECTION);
  // Assigned in the last 24 h; topped up with the latest assignments so the list is never thin.
  const newest = mine.filter((l) => Date.parse(l.createdAt) <= nowMs).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const last24h = newest.filter((l) => Date.parse(l.createdAt) >= nowMs - DAY_MS);
  const newAssigned = (last24h.length >= 8 ? last24h : newest.filter((l) => Date.parse(l.createdAt) >= nowMs - 3 * DAY_MS).slice(0, 8)).slice(0, MAX_PER_SECTION);

  const todayStart = istDayStart(nowMs);
  const callsToday = (world.indexes().callsByUser.get(me.user.id) ?? []).filter((c) => Date.parse(c.startedAt) >= todayStart && Date.parse(c.startedAt) <= nowMs);
  const ended = callsToday.filter((c) => c.status !== 'in_progress');
  const monthStart = istMonthStart(nowMs);
  const wonInrThisMonth = (ctx.leadsByOwner.get(me.user.id) ?? []).reduce((s, l) => {
    const w = wonAt(ctx, l);
    return w !== null && w >= monthStart && w <= nowMs ? s + l.valueInr : s;
  }, 0);
  // Rank by revenue won this month among people who sell.
  const revenueBy = ctx.sellers.map((u) => ({
    id: u.id,
    inr: (ctx.leadsByOwner.get(u.id) ?? []).reduce((s, l) => {
      const w = wonAt(ctx, l);
      return w !== null && w >= monthStart && w <= nowMs ? s + l.valueInr : s;
    }, 0),
  }));
  revenueBy.sort((a, b) => b.inr - a.inr);
  const rankIdx = revenueBy.findIndex((r) => r.id === me.user.id);

  const leadPhones = new Map(currentMockLeads().map((l) => [l.id, l.phone] as const));
  const phones = Object.fromEntries([...callsToMake, ...tasksDue, ...later].filter((t) => t.leadId).map((t) => [t.leadId!, leadPhones.get(t.leadId!) ?? null]));

  return {
    phones,
    later,
    today: {
      tasksDue,
      followUps,
      callsToMake,
      newAssigned,
      targets: targetsForUser(me.user.id, istPeriod(nowMs)),
      stats: {
        callsToday: callsToday.length,
        talkSecToday: ended.reduce((s, c) => s + c.durationSec, 0),
        leadsContactedToday: new Set(callsToday.filter((c) => c.leadId).map((c) => c.leadId)).size,
        wonInrThisMonth,
        rank: me.workspace.showEmployeeRank && rankIdx >= 0 ? rankIdx + 1 : null,
      },
      generatedAt: new Date(nowMs).toISOString(),
    },
  };
}

/** Recent calls (most recent first) for the Calls page: today and the previous days, up to 20. */
export function buildRecentCalls(me: MeResponse, nowMs: number): Call[] {
  return listCalls({ userId: me.user.id, limit: 20 }, viewerFromMe(me)).items.filter((c) => Date.parse(c.startedAt) <= nowMs);
}

/** Calls per day this week (Mon..Sun, IST) for My performance; days after today are 0. */
export function buildWeekCalls(me: MeResponse, nowMs = Date.now()): number[] {
  const monday = istDayStart(nowMs) - istWeekday(nowMs) * DAY_MS;
  const week = Array.from({ length: 7 }, () => 0);
  for (const c of world.indexes().callsByUser.get(me.user.id) ?? []) {
    const t = Date.parse(c.startedAt);
    if (t < monday || t > nowMs) continue;
    week[Math.floor((t - monday) / DAY_MS)]!++;
  }
  return week;
}
