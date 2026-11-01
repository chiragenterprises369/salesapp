'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from '@/components/ui/toast';
import { useMe } from '@/lib/session/session';
import { buildMyDay, buildRecentCalls } from './my-day-mock';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Employee Home data (mock). Wave 3: GET /me/today; realtime events patch it. */
export function useMyDay() {
  const me = useMe()!;
  return useQuery({
    queryKey: ['dashboard', 'my-today', me.user.id],
    queryFn: async () => {
      await wait(300);
      return buildMyDay(me, Date.now());
    },
    staleTime: 5 * 60_000,
  });
}

/** My recent calls (mock). Wave 3: GET /calls?userId=me. */
export function useRecentCalls() {
  const me = useMe()!;
  return useQuery({
    queryKey: ['calls', 'mine', me.user.id],
    queryFn: async () => {
      await wait(300);
      return buildRecentCalls(me, Date.now());
    },
    staleTime: 5 * 60_000,
  });
}

/** "+91 98100 00003" */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return 'No number';
  return e164.startsWith('+91') && e164.length === 13 ? `+91 ${e164.slice(3, 8)} ${e164.slice(8)}` : e164;
}

/**
 * Click-to-call (mock). Wave 3: POST /calls { leadId } through the telephony adapter, which rings the
 * rep's phone first and then connects the lead.
 */
export function useClickToCall() {
  return useCallback((target: { name: string; phone: string | null }) => {
    if (!target.phone) {
      toast.error(`${target.name} has no phone number. Add one on the lead first.`);
      return;
    }
    toast(`Calling ${target.name}`, { description: `Your phone rings first, then Vistar connects ${formatPhone(target.phone)}.` });
  }, []);
}
