'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Meeting, MeetingListQuery, RouteBody } from '@vistar/shared';
import { crmKeys } from './keys';
import { getCrmSource } from './source';

/** Meetings, availability and time off. */
const src = () => getCrmSource();

export function useMeetings(q: MeetingListQuery | null) {
  return useQuery({
    queryKey: crmKeys.calendar.meetings(q ?? {}),
    queryFn: () => src().calendar.meetings(q!),
    enabled: !!q,
    placeholderData: keepPreviousData,
  });
}

export function useMeeting(id: string | null) {
  return useQuery({ queryKey: crmKeys.calendar.meeting(id ?? ''), queryFn: () => src().calendar.get(id!), enabled: !!id });
}

export function useAvailability(q: { userId?: string[]; from: string; to: string } | null) {
  return useQuery({
    queryKey: crmKeys.calendar.availability(q ?? {}),
    queryFn: () => src().calendar.availability(q!),
    enabled: !!q,
    staleTime: 30_000,
  });
}

/** Optimistic reschedule (drag on the calendar): patches every cached meeting list first. */
export function useRescheduleMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ meeting, startAt, endAt }: { meeting: Meeting; startAt: string; endAt: string }) =>
      src().calendar.update(meeting.id, {
        startAt,
        endAt,
        expectedVersion: meeting.version,
        ...(meeting.recurrence && meeting.occurrenceStart ? { scope: 'occurrence' as const, occurrenceStart: meeting.occurrenceStart } : {}),
      }),
    onMutate: async ({ meeting, startAt, endAt }) => {
      await qc.cancelQueries({ queryKey: ['calendar', 'meetings'] });
      const snapshot = qc.getQueriesData<Meeting[]>({ queryKey: ['calendar', 'meetings'] });
      qc.setQueriesData<Meeting[]>({ queryKey: ['calendar', 'meetings'] }, (list) =>
        list?.map((m) => (m.id === meeting.id && m.occurrenceStart === meeting.occurrenceStart ? { ...m, startAt, endAt } : m)),
      );
      return { snapshot };
    },
    onError: (_e, _v, ctx) => ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: () => qc.invalidateQueries({ queryKey: crmKeys.calendar.all }),
  });
}

export function useMeetingMutations() {
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: crmKeys.calendar.all }),
      qc.invalidateQueries({ queryKey: ['contacts', 'related'] }),
      qc.invalidateQueries({ queryKey: ['accounts', 'related'] }),
      qc.invalidateQueries({ queryKey: ['deals', 'related'] }),
    ]);
  return {
    create: useMutation({ mutationFn: (body: RouteBody<'meetingCreate'>) => src().calendar.create(body), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: RouteBody<'meetingUpdate'> }) => src().calendar.update(id, patch), onSuccess: refresh }),
    cancel: useMutation({ mutationFn: ({ id, body }: { id: string; body: RouteBody<'meetingCancel'> }) => src().calendar.cancel(id, body), onSuccess: refresh }),
    respond: useMutation({ mutationFn: ({ id, body }: { id: string; body: RouteBody<'meetingRespond'> }) => src().calendar.respond(id, body), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => src().calendar.remove(id), onSuccess: refresh }),
  };
}

export function useTimeOff(q: { userId?: string[]; from?: string; to?: string } | null) {
  return useQuery({ queryKey: crmKeys.calendar.timeOff(q ?? {}), queryFn: () => src().calendar.timeOff(q!), enabled: !!q });
}

export function useTimeOffMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: crmKeys.calendar.all });
  return {
    create: useMutation({ mutationFn: (body: RouteBody<'timeOffCreate'>) => src().calendar.createTimeOff(body), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => src().calendar.deleteTimeOff(id), onSuccess: refresh }),
  };
}
