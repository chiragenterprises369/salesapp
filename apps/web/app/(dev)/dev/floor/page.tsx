'use client';

import { TeamFloor } from '@/features/team-floor';
import { DevFrame } from '../dev-frame';

/** Dev preview for frontend-3d (orchestrator-owned route). */
export default function DevFloorPage() {
  return (
    <DevFrame title="Live Team Floor">
      <TeamFloor mode="auto" />
    </DevFrame>
  );
}
