import { z } from 'zod';
import { NODE_CATALOG, nodeConfigSchemas, NodeTypeSchema, type NodeConfig, type NodeType } from './nodes.js';

/**
 * Workflow JSON: { schemaVersion, version, nodes, edges }.
 * - Stored per WorkflowVersion; the builder edits a draft graph.
 * - React Flow compatible: node.position and edge.sourceHandle/targetHandle map 1:1.
 */
export const GRAPH_SCHEMA_VERSION = 1 as const;
export const MAX_NODES = 100;

export const WorkflowNodeSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: NodeTypeSchema,
    position: z.object({ x: z.number(), y: z.number() }),
    data: z.object({
      label: z.string().max(80).optional(),
      notes: z.string().max(500).optional(),
      config: z.record(z.string(), z.unknown()),
    }),
  });

export type WorkflowNode<T extends NodeType = NodeType> = {
  id: string;
  type: T;
  position: { x: number; y: number };
  data: { label?: string; notes?: string; config: NodeConfig<T> };
};

export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1).max(130),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().default('out'),
  targetHandle: z.string().default('in'),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowGraphSchema = z.object({
  schemaVersion: z.literal(GRAPH_SCHEMA_VERSION).default(GRAPH_SCHEMA_VERSION),
  version: z.number().int().min(0).describe('Workflow version number this graph belongs to; 0 = unsaved draft'),
  nodes: z.array(WorkflowNodeSchema).max(MAX_NODES),
  edges: z.array(WorkflowEdgeSchema),
});
export type WorkflowGraph = {
  schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export interface GraphIssue {
  nodeId: string | null;
  edgeId: string | null;
  path: string | null;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Validate a graph. Used by the builder (inline errors) and by the engine (before activation
 * and test runs). Returns [] when valid.
 */
export function validateGraph(graph: WorkflowGraph, opts: { aiEnabled?: boolean } = {}): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const err = (message: string, nodeId: string | null = null, edgeId: string | null = null, path: string | null = null) =>
    issues.push({ message, nodeId, edgeId, path, severity: 'error' });
  const warn = (message: string, nodeId: string | null = null) =>
    issues.push({ message, nodeId, edgeId: null, path: null, severity: 'warning' });

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  if (byId.size !== graph.nodes.length) err('Node ids must be unique');

  const triggers = graph.nodes.filter((n) => NODE_CATALOG[n.type].category === 'trigger');
  if (triggers.length === 0) err('Add a trigger to start the workflow');
  if (triggers.length > 1) triggers.slice(1).forEach((t) => err('Only one trigger is allowed', t.id));

  for (const node of graph.nodes) {
    const def = NODE_CATALOG[node.type];
    if (def.featureFlag === 'FEATURE_AI_NODE' && !opts.aiEnabled) err('AI nodes are not enabled for this workspace', node.id);
    const parsed = nodeConfigSchemas[node.type].safeParse(node.data.config);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) err(issue.message, node.id, null, issue.path.join('.'));
    }
  }

  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const src = byId.get(edge.source);
    const tgt = byId.get(edge.target);
    if (!src || !tgt) {
      err('Connection points to a missing node', null, edge.id);
      continue;
    }
    if (NODE_CATALOG[tgt.type].category === 'trigger') err('Triggers cannot have incoming connections', tgt.id, edge.id);
    const handles = NODE_CATALOG[src.type].outputs(src.data.config as Record<string, unknown>);
    if (!handles.includes(edge.sourceHandle)) err(`Unknown output "${edge.sourceHandle}"`, src.id, edge.id);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  // Each output handle should connect at most once.
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    const key = `${edge.source}:${edge.sourceHandle}`;
    if (seen.has(key)) err('An output can only connect to one node', edge.source, edge.id);
    seen.add(key);
  }

  // Reachability from the trigger.
  const start = triggers[0];
  if (start) {
    const reached = new Set<string>([start.id]);
    const queue = [start.id];
    while (queue.length) {
      const id = queue.shift() as string;
      for (const next of outgoing.get(id) ?? []) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }
    for (const n of graph.nodes) if (!reached.has(n.id)) warn('This step is not connected to the trigger', n.id);
  }

  // Cycles are only allowed when they pass through a loop_limit node.
  const color = new Map<string, 0 | 1 | 2>();
  const visit = (id: string, stack: string[]): void => {
    color.set(id, 1);
    for (const next of outgoing.get(id) ?? []) {
      const c = color.get(next) ?? 0;
      if (c === 1) {
        const cycle = [...stack.slice(stack.indexOf(next)), id];
        if (!cycle.some((cid) => byId.get(cid)?.type === 'logic.loop_limit')) err('Loops need a Loop limit step', next);
      } else if (c === 0) visit(next, [...stack, id]);
    }
    color.set(id, 2);
  };
  for (const n of graph.nodes) if ((color.get(n.id) ?? 0) === 0) visit(n.id, []);

  return issues;
}

export function emptyGraph(): WorkflowGraph {
  return { schemaVersion: GRAPH_SCHEMA_VERSION, version: 0, nodes: [], edges: [] };
}
