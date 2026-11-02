'use client';

import { Suspense } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { FloorWorkspace } from '@/features/team-floor/workspace';
import { useMe } from '@/lib/session/session';
import { FloorNotLiveYet, FloorWorkspaceFallback, useLiveFloorReady } from '@/app/(company)/app/team-floor/team-floor-view';

/**
 * Employee Team Floor: read-only floor (status, room and activity of colleagues) as a workspace with the
 * employee's own panels (Leads, Inbox, Tasks, Calls, Today), the command bar (also to set one's own
 * status) and full screen. Flat view unless the user picked 3D in preferences.
 */
export default function MyTeamFloorPage() {
  const me = useMe()!;
  const ready = useLiveFloorReady();
  const mode = me.settings.teamFloorMode === 'auto' ? 'flat' : me.settings.teamFloorMode;
  return (
    <RequirePermission anyOf={['teamfloor.read']}>
      {ready ? (
        <Suspense fallback={<FloorWorkspaceFallback />}>
          <FloorWorkspace panel="employee" title="Team Floor" description="See who is free, on a call or on a break, and work from here." mode={mode} readOnly />
        </Suspense>
      ) : (
        <FloorNotLiveYet />
      )}
    </RequirePermission>
  );
}
