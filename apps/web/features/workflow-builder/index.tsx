'use client';

import type { WorkflowGraph } from '@vistar/shared';
import '@xyflow/react/dist/base.css';
import './builder.css';
import { BuilderRoot } from './components/builder';

/**
 * PUBLIC API of features/workflow-builder (contract; owner frontend-physics replaces the
 * implementation, keeps the export name and props). Mounted at /app/workflows/[id] by frontend-app.
 */
export interface WorkflowBuilderProps {
  /** Workflow id, or "new". Wave 1 loads mock data (WORKFLOW_TEMPLATES) by id/templateKey. */
  workflowId: string;
  /** Optional initial graph (e.g. from a template). */
  initialGraph?: WorkflowGraph;
  /** Hide editing affordances (users without workflows.edit). */
  readOnly?: boolean;
  onSave?: (graph: WorkflowGraph) => Promise<void> | void;
}

export function WorkflowBuilder(props: WorkflowBuilderProps) {
  // Remount on a different workflow so the editor state never leaks between workflows.
  return <BuilderRoot key={props.workflowId} {...props} />;
}
