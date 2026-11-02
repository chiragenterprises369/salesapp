import { NODE_CATALOG, WORKFLOW_TEMPLATES, type NodeType, type WorkflowGraph, type WorkflowListItem, type WorkflowStatus } from '@vistar/shared';
import { WORKFLOW_FIXTURE_STATE } from '@vistar/shared/fixtures';
import { workflowStatsByKey } from '@/lib/world';
import { worldNow } from '@/lib/world/world';

/**
 * Wave 1 workflow list built from the shipped templates (ids = template keys, which the builder
 * accepts in Wave 1). Status and last edit come from the world fixtures; run stats are counted from
 * the world's workflow runs (last 30 days) the first time a list reads them. Wave 3: GET /workflows.
 */
export type MockWorkflow = Pick<WorkflowListItem, 'name' | 'description' | 'status' | 'triggerType' | 'stats' | 'updatedAt' | 'templateKey'> & {
  id: string;
  graph: WorkflowGraph;
  /** Start of the latest run (null if it never ran). */
  lastRunAt: string | null;
};

export function triggerOf(graph: WorkflowGraph): NodeType | null {
  return (graph.nodes.find((n) => n.type.startsWith('trigger.'))?.type as NodeType | undefined) ?? null;
}

export function triggerLabel(type: NodeType | null): string {
  return type ? NODE_CATALOG[type].label : 'No trigger yet';
}

const empty = { runs: 0, completed: 0, failed: 0, active: 0, lastRunAt: null };

export const MOCK_WORKFLOWS: MockWorkflow[] = WORKFLOW_TEMPLATES.map((t) => {
  const s = WORKFLOW_FIXTURE_STATE[t.key] ?? { status: 'draft' as const, editedHoursAgo: 200, version: 0 };
  return {
    id: t.key,
    templateKey: t.key,
    name: t.name,
    description: t.description,
    status: s.status,
    triggerType: triggerOf(t.graph),
    // Lazy: the world (2,500 leads and their runs) is only generated when a list shows the numbers.
    get stats() {
      const r = workflowStatsByKey().get(t.key) ?? empty;
      return { runs: r.runs, completed: r.completed, failed: r.failed, active: r.active };
    },
    get lastRunAt() {
      return (workflowStatsByKey().get(t.key) ?? empty).lastRunAt;
    },
    get updatedAt() {
      return new Date(worldNow() - s.editedHoursAgo * 3_600_000).toISOString();
    },
    graph: t.graph,
  };
});

export const WORKFLOW_STATUS_TONE: Record<WorkflowStatus, 'green' | 'amber' | 'grey' | 'neutral'> = {
  active: 'green',
  paused: 'amber',
  draft: 'grey',
  archived: 'neutral',
};

export const WORKFLOW_STATUS_LABEL: Record<WorkflowStatus, string> = { active: 'Active', paused: 'Paused', draft: 'Draft', archived: 'Archived' };
