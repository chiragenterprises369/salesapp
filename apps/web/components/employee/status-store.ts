'use client';

import type { EmployeeStatus, StatusUpdate } from '@vistar/shared';
import { create } from 'zustand';
import { toast } from '@/components/ui/toast';
import { isMockData } from '@/lib/api/data-source';
import { isRouteLive, notAvailableYet } from '@/lib/api/availability';
import { useMe, useSessionStore } from '@/lib/session/session';

/** Statuses an employee can set; `busy` is set automatically (D-019). */
export type SelfStatus = 'idle' | 'on_call' | 'away' | 'offline';

/** Status control value -> PUT /me/status (D-062: Break is `on_break`; On call comes from the phone). */
const TO_MANUAL: Record<SelfStatus, StatusUpdate['status'] | null> = { idle: 'idle', away: 'on_break', offline: 'offline', on_call: null };

interface StatusState {
  /** Optimistic value per user id until the server answers (mock mode keeps it). */
  byUser: Record<string, EmployeeStatus>;
  set: (userId: string, status: SelfStatus) => void;
  clear: (userId: string) => void;
}

const useStatusStore = create<StatusState>()((set) => ({
  byUser: {},
  set: (userId, status) => set((s) => ({ byUser: { ...s.byUser, [userId]: status } })),
  clear: (userId) =>
    set((s) => {
      const next = { ...s.byUser };
      delete next[userId];
      return { byUser: next };
    }),
}));

async function save(userId: string, status: SelfStatus): Promise<void> {
  const manual = TO_MANUAL[status];
  if (!manual) throw new Error('On call is set for you while a call is live. Pick another status.');
  if (!isRouteLive('myStatusUpdate')) throw notAvailableYet('Setting your status');
  await useSessionStore.getState().setStatus(manual);
  useStatusStore.getState().clear(userId);
}

/** My current presence status and a setter (optimistic; PUT /me/status in API mode). */
export function useMyStatus(): [EmployeeStatus, (status: SelfStatus) => void] {
  const me = useMe();
  const userId = me?.user.id ?? '';
  const override = useStatusStore((s) => s.byUser[userId]);
  const setLocal = useStatusStore((s) => s.set);
  return [
    override ?? me?.user.status ?? 'offline',
    (status) => {
      setLocal(userId, status);
      if (isMockData()) return;
      save(userId, status).catch((e: unknown) => {
        useStatusStore.getState().clear(userId);
        toast.error(e instanceof Error ? e.message : 'Your status was not saved. Try again.');
      });
    },
  ];
}
