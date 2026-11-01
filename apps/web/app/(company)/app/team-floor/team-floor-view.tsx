'use client';

import { RequirePermission } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/common/page-header';
import { TeamFloor } from '@/features/team-floor';
import { useMe } from '@/lib/session/session';

/** Live Team Floor (company panel). Managers see their team only (dataScope=team). */
export function TeamFloorView() {
  const me = useMe()!;
  const teamOnly = me.role.dataScope === 'team';
  return (
    <RequirePermission anyOf={['teamfloor.read']}>
      <PageHeader
        title="Live Team Floor"
        description={teamOnly ? 'Who is on a call, free or on a break in your team, right now.' : 'Who is on a call, free or on a break across the workspace, right now.'}
        className="mb-3"
      />
      <TeamFloor mode={me.settings.teamFloorMode} userIds={teamOnly ? me.teamMemberIds : null} />
    </RequirePermission>
  );
}
