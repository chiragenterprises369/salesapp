'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { isMockData, noteMockUse } from '@/lib/api/data-source';
import { useMe } from '@/lib/session/session';
import { mockFieldLive, mockRegister, mockRoute } from './mock';

/**
 * Attendance data (D-063): GET /attendance (register), GET /field/live (latest positions),
 * GET /field/users/{id}/route (one person's day). All need team.read; the API applies the data scope
 * (managers: their team) and the field_tracking flag. Query keys start with the `attendance` sync scope,
 * so `attendance.*` and `location.updated` events refresh them (lib/realtime/logic).
 */
export const attendanceKeys = {
  register: (userId: string | null, q: { date: string; teamId: string | null; fieldStaffOnly: boolean }) => ['attendance', 'register', userId, q] as const,
  live: (userId: string | null, teamId: string | null) => ['attendance', 'field-live', userId, teamId] as const,
  route: (userId: string | null, personId: string | null, date: string) => ['attendance', 'route', userId, personId, date] as const,
};

function useCanRead(): { me: ReturnType<typeof useMe>; enabled: boolean } {
  const me = useMe();
  return { me, enabled: !!me && (isMockData() || me.permissions.includes('team.read')) };
}

export function useAttendanceRegister(q: { date: string; teamId: string | null; fieldStaffOnly: boolean }) {
  const { me, enabled } = useCanRead();
  return useQuery({
    queryKey: attendanceKeys.register(me?.user.id ?? null, q),
    queryFn: () => {
      if (isMockData()) {
        noteMockUse('attendance');
        return mockRegister(q.date);
      }
      return api.call('attendanceRegister', {
        query: { date: q.date, ...(q.teamId ? { teamId: q.teamId } : {}), ...(q.fieldStaffOnly ? { fieldStaffOnly: true } : {}) },
      });
    },
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useFieldLive(teamId: string | null) {
  const { me, enabled } = useCanRead();
  return useQuery({
    queryKey: attendanceKeys.live(me?.user.id ?? null, teamId),
    queryFn: () => {
      if (isMockData()) {
        noteMockUse('attendance');
        return mockFieldLive();
      }
      return api.call('fieldLive', { query: teamId ? { teamId } : {} });
    },
    enabled,
    // Positions arrive every 2 min per person; events refresh it sooner. Stale marks need a fresh list.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useFieldRoute(personId: string | null, date: string) {
  const { me, enabled } = useCanRead();
  return useQuery({
    queryKey: attendanceKeys.route(me?.user.id ?? null, personId, date),
    queryFn: () => {
      if (isMockData()) {
        noteMockUse('attendance');
        return mockRoute(personId!, date);
      }
      return api.call('fieldUserRoute', { params: { id: personId! }, query: { date } });
    },
    enabled: enabled && !!personId,
    placeholderData: keepPreviousData,
  });
}
