import { NODE_CATALOG, WORKFLOW_TEMPLATES, type NodeType, type WorkflowGraph, type WorkflowListItem, type WorkflowStatus } from '@vistar/shared';

/**
 * Wave 1 workflow list built from the shipped templates (ids = template keys, which the builder
 * accepts in Wave 1). Wave 3: GET /workflows.
 */
export type MockWorkflow = Pick<WorkflowListItem, 'name' | 'description' | 'status' | 'triggerType' | 'stats' | 'updatedAt' | 'templateKey'> & {
  id: string;
  graph: WorkflowGraph;
};

const STATE: Record<string, { status: WorkflowStatus; runs: number; failed: number; active: number; hoursAgo: number }> = {
  indiamart_nurturing: { status: 'active', runs: 1284, failed: 7, active: 41, hoursAgo: 3 },
  missed_call_follow_up: { status: 'active', runs: 342, failed: 2, active: 5, hoursAgo: 26 },
  quote_reminder: { status: 'paused', runs: 96, failed: 11, active: 0, hoursAgo: 72 },
  inactive_lead_revival: { status: 'draft', runs: 0, failed: 0, active: 0, hoursAgo: 150 },
};

const BASE_TIME = Date.parse('2026-11-01T10:00:00+05:30');

export function triggerOf(graph: WorkflowGraph): NodeType | null {
  return (graph.nodes.find((n) => n.type.startsWith('trigger.'))?.type as NodeType | undefined) ?? null;
}

export function triggerLabel(type: NodeType | null): string {
  return type ? NODE_CATALOG[type].label : 'No trigger yet';
}

export const MOCK_WORKFLOWS: MockWorkflow[] = WORKFLOW_TEMPLATES.map((t) => {
  const s = STATE[t.key] ?? { status: 'draft' as const, runs: 0, failed: 0, active: 0, hoursAgo: 200 };
  return {
    id: t.key,
    templateKey: t.key,
    name: t.name,
    description: t.description,
    status: s.status,
    triggerType: triggerOf(t.graph),
    stats: { runs: s.runs, completed: s.runs - s.failed - s.active, failed: s.failed, active: s.active },
    updatedAt: new Date(BASE_TIME - s.hoursAgo * 3_600_000).toISOString(),
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
