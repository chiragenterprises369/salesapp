'use client';

import { Suspense } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { FloorWorkspace } from '@/features/team-floor/workspace';
import { isRouteLive } from '@/lib/api/availability';
import { isMockData } from '@/lib/api/data-source';
import { useMe } from '@/lib/session/session';

/**
 * True when the floor can show real people: the server snapshot (GET /team-floor/snapshot) and live
 * status ship with the presence engine. Until then API mode shows an empty state, never simulated people.
 */
export function useLiveFloorReady(): boolean {
  return isMockData() || isRouteLive('teamFloorSnapshot');
}

export function FloorNotLiveYet() {
  return (
    <EmptyState
      title="The live floor starts with live status"
      description="Once live status is switched on, everyone who signs in to Vistar on the web or the Android app shows up here with their real status: available, on a call, on a break or offline."
    />
  );
}

/** The workspace reads the URL (lead drawer, panels): suspense boundary for useSearchParams. */
export function FloorWorkspaceFallback() {
  return <Skeleton className="h-[calc(100dvh-10rem)] min-h-[420px] w-full rounded-lg" aria-label="Team floor loading" />;
}

/**
 * Live Team Floor (company panel) as a workspace (SPEC 29.11): the floor, person panel, module panels,
 * command bar and full screen in one tab. Managers see their team only (dataScope=team).
 */
export function TeamFloorView() {
  const me = useMe()!;
  const ready = useLiveFloorReady();
  const teamOnly = me.role.dataScope === 'team';
  return (
    <RequirePermission anyOf={['teamfloor.read']}>
      {ready ? (
        <Suspense fallback={<FloorWorkspaceFallback />}>
          <FloorWorkspace
            panel="company"
            title="Live Team Floor"
            description={
              teamOnly
                ? 'Who is where and doing what in your team, right now. Open leads, chats, tasks and calls without leaving the floor.'
                : 'Who is where and doing what across the company, right now. Open leads, chats, tasks and calls without leaving the floor.'
            }
            mode={me.settings.teamFloorMode}
            userIds={teamOnly ? me.teamMemberIds : null}
          />
        </Suspense>
      ) : (
        <FloorNotLiveYet />
      )}
    </RequirePermission>
  );
}
