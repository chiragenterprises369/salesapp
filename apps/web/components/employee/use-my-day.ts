'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Call, Task } from '@vistar/shared';
import { DAY_MS, istDayStart, istWeekday } from '@vistar/shared/fixtures';
import { useCallback } from 'react';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api/client';
import { isMockData } from '@/lib/api/data-source';
import { leadKeys } from '@/lib/leads/data';
import { useMe } from '@/lib/session/session';
import { buildMyDay, buildRecentCalls, buildWeekCalls, type MyDay } from './my-day-mock';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Lead phones fetched for the call buttons of task rows (tasks carry only leadId and leadName). */
const MAX_PHONE_LOOKUPS = 30;

/**
 * Employee Home data: GET /me/today (own scope) plus the open tasks of the next 7 days. The
 * test-only mock data mode builds the same shape from the mock world.
 */
export function useMyDay() {
  const me = useMe()!;
  const qc = useQueryClient();
  const mock = isMockData();
  return useQuery({
    queryKey: ['dashboard', 'my-today', me.user.id],
    queryFn: async (): Promise<MyDay> => {
      if (mock) {
        await wait(300);
        return buildMyDay(me, Date.now());
      }
      const now = Date.now();
      const endOfDay = istDayStart(now) + DAY_MS;
      const [today, later] = await Promise.all([
        api.call('myToday'),
        api.call('taskList', {
          query: { scope: 'mine', status: ['open'], from: new Date(endOfDay).toISOString(), to: new Date(endOfDay + 7 * DAY_MS).toISOString(), limit: 15 },
        }),
      ]);
      const phones: Record<string, string | null> = {};
      for (const l of [...today.followUps, ...today.newAssigned]) phones[l.id] = l.phone;
      const missing = [...new Set([...today.callsToMake, ...today.tasksDue, ...later.items].map((t: Task) => t.leadId).filter((id): id is string => !!id && !(id in phones)))];
      await Promise.all(
        missing.slice(0, MAX_PHONE_LOOKUPS).map(async (id) => {
          try {
            const lead = await qc.fetchQuery({ queryKey: leadKeys.detail(id), queryFn: () => api.call('leadGet', { params: { id } }), staleTime: 60_000 });
            phones[id] = lead.phone;
          } catch {
            phones[id] = null;
          }
        }),
      );
      return { today, phones, later: later.items };
    },
    staleTime: 60_000,
  });
}

/** My recent calls (GET /calls?userId=me). */
export function useRecentCalls() {
  const me = useMe()!;
  const mock = isMockData();
  return useQuery({
    queryKey: ['calls', 'mine', me.user.id],
    queryFn: async (): Promise<Call[]> => {
      if (mock) {
        await wait(300);
        return buildRecentCalls(me, Date.now());
      }
      return (await api.call('callList', { query: { userId: me.user.id, limit: 20 } })).items;
    },
    staleTime: 60_000,
  });
}

/** Calls per day this week (Mon..Sun) for My performance (GET /calls?userId=me&from=Monday). */
export function useWeekCalls(): number[] {
  const me = useMe()!;
  const mock = isMockData();
  const q = useQuery({
    queryKey: ['calls', 'mine', me.user.id, 'week'],
    queryFn: async (): Promise<number[]> => {
      if (mock) return buildWeekCalls(me);
      const now = Date.now();
      const monday = istDayStart(now) - istWeekday(now) * DAY_MS;
      const week = Array.from({ length: 7 }, () => 0);
      let cursor: string | undefined;
      let seen = 0;
      do {
        const page = await api.call('callList', { query: { userId: me.user.id, from: new Date(monday).toISOString(), to: new Date(now).toISOString(), limit: 200, cursor } });
        for (const c of page.items) {
          const t = Date.parse(c.startedAt);
          if (t >= monday && t <= now) week[Math.min(6, Math.floor((t - monday) / DAY_MS))]!++;
        }
        seen += page.items.length;
        cursor = page.nextCursor ?? undefined;
      } while (cursor && seen < 2_000);
      return week;
    },
    staleTime: 60_000,
  });
  return q.data ?? EMPTY_WEEK;
}
const EMPTY_WEEK = [0, 0, 0, 0, 0, 0, 0];

/** "+91 98100 00003" */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return 'No number';
  return e164.startsWith('+91') && e164.length === 13 ? `+91 ${e164.slice(3, 8)} ${e164.slice(8)}` : e164;
}

/**
 * Click-to-call. API mode opens the phone dialer (`tel:`), so the call goes out from the employee's
 * own SIM (SPEC 29.1); the Android app reports it. Mock mode only shows the toast.
 */
export function useClickToCall() {
  return useCallback((target: { name: string; phone: string | null }) => {
    if (!target.phone) {
      toast.error(`${target.name} has no phone number. Add one on the lead first.`);
      return;
    }
    if (!isMockData()) {
      toast(`Calling ${target.name}`, { description: `Opening your phone dialer for ${formatPhone(target.phone)}.` });
      window.location.href = `tel:${target.phone}`;
      return;
    }
    toast(`Calling ${target.name}`, { description: `Your phone rings first, then Vistar connects ${formatPhone(target.phone)}.` });
  }, []);
}
