'use client';

import { RequirePermission } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/common/page-header';
import { TeamFloor } from '@/features/team-floor';
import { useMe } from '@/lib/session/session';
import { FloorNotLiveYet, useLiveFloorReady } from '@/app/(company)/app/team-floor/team-floor-view';

/** Read-only Team Floor for employees; flat view unless the user picked 3D in preferences. */
export default function MyTeamFloorPage() {
  const me = useMe()!;
  const ready = useLiveFloorReady();
  const mode = me.settings.teamFloorMode === 'auto' ? 'flat' : me.settings.teamFloorMode;
  return (
    <RequirePermission anyOf={['teamfloor.read']}>
      <PageHeader title="Team Floor" description="See who is free, on a call or on a break." className="mb-3" />
      {ready ? <TeamFloor readOnly mode={mode} /> : <FloorNotLiveYet />}
    </RequirePermission>
  );
}
