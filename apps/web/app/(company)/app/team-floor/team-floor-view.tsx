'use client';

import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { TeamFloor } from '@/features/team-floor';
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

/** Live Team Floor (company panel). Managers see their team only (dataScope=team). */
export function TeamFloorView() {
  const me = useMe()!;
  const ready = useLiveFloorReady();
  const teamOnly = me.role.dataScope === 'team';
  return (
    <RequirePermission anyOf={['teamfloor.read']}>
      <PageHeader
        title="Live Team Floor"
        description={teamOnly ? 'Who is on a call, free or on a break in your team, right now.' : 'Who is on a call, free or on a break across the workspace, right now.'}
        className="mb-3"
      />
      {ready ? <TeamFloor mode={me.settings.teamFloorMode} userIds={teamOnly ? me.teamMemberIds : null} /> : <FloorNotLiveYet />}
    </RequirePermission>
  );
}
