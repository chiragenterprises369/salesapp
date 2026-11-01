'use client';

import { WORKFLOW_TEMPLATES } from '@vistar/shared';
import { WorkflowBuilder } from '@/features/workflow-builder';
import { DevFrame } from '../dev-frame';

/** Dev preview for frontend-physics (orchestrator-owned route). */
export default function DevBuilderPage() {
  const tpl = WORKFLOW_TEMPLATES[0]!;
  return (
    <DevFrame title="Workflow builder" persona="company_admin">
      <WorkflowBuilder workflowId={tpl.key} initialGraph={tpl.graph} />
    </DevFrame>
  );
}
