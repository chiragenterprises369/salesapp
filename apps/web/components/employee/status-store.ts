'use client';

import type { EmployeeStatus } from '@vistar/shared';
import { create } from 'zustand';
import { useMe } from '@/lib/session/session';

/** Statuses an employee can set; `busy` is set automatically (D-019). */
export type SelfStatus = 'idle' | 'on_call' | 'away' | 'offline';

interface StatusState {
  /** Local override per user id (Wave 1 mock). Wave 3: PUT /me/status, then employee.status_changed. */
  byUser: Record<string, EmployeeStatus>;
  set: (userId: string, status: SelfStatus) => void;
}

const useStatusStore = create<StatusState>()((set) => ({
  byUser: {},
  set: (userId, status) => set((s) => ({ byUser: { ...s.byUser, [userId]: status } })),
}));

/** My current presence status and a setter (mock local state). */
export function useMyStatus(): [EmployeeStatus, (status: SelfStatus) => void] {
  const me = useMe();
  const userId = me?.user.id ?? '';
  const override = useStatusStore((s) => s.byUser[userId]);
  const setStatus = useStatusStore((s) => s.set);
  return [override ?? me?.user.status ?? 'offline', (status) => setStatus(userId, status)];
}
