'use client';

import { MOCK_PIPELINE_ID } from '@vistar/shared/fixtures';
import { LeadsBoardView } from '@/features/pipeline';
import { DevFrame } from '../dev-frame';

/** Dev preview for frontend-physics (orchestrator-owned route). */
export default function DevBoardPage() {
  return (
    <DevFrame title="Leads board">
      <LeadsBoardView pipelineId={MOCK_PIPELINE_ID} />
    </DevFrame>
  );
}
