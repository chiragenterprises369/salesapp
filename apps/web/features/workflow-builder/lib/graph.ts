import {
  emptyGraph,
  GRAPH_SCHEMA_VERSION,
  NODE_CATALOG,
  nodeConfigSchemas,
  WORKFLOW_TEMPLATES,
  type NodeType,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from '@vistar/shared';
import type { Edge, Node } from '@xyflow/react';
import { CATEGORY_META, categoryOf } from './catalog';

/** React Flow node: `type` is the workflow node type, `data` is the contract node data. */
export type FlowNodeData = { label?: string; notes?: string; config: Record<string, unknown> };
export type FlowNode = Node<FlowNodeData, NodeType> & { type: NodeType };
export type FlowEdge = Edge<Record<string, unknown>, 'rope'>;

export function displayLabel(type: NodeType, data: { label?: string }): string {
  return data.label?.trim() || NODE_CATALOG[type].label;
}

export function nodeAriaLabel(type: NodeType, data: { label?: string }): string {
  return `${displayLabel(type, data)}, ${CATEGORY_META[categoryOf(type)].label.toLowerCase()} step`;
}

export function toFlowNode(n: WorkflowNode): FlowNode {
  const data: FlowNodeData = { config: { ...(n.data.config as Record<string, unknown>) } };
  if (n.data.label) data.label = n.data.label;
  if (n.data.notes) data.notes = n.data.notes;
  return {
    id: n.id,
    type: n.type,
    position: { x: n.position.x, y: n.position.y },
    data,
    ariaLabel: nodeAriaLabel(n.type, data),
  };
}

export function edgeId(source: string, sourceHandle: string, target: string): string {
  return `${source}-${sourceHandle}-${target}`.slice(0, 130);
}

export function toFlowEdge(e: WorkflowEdge): FlowEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? 'out',
    targetHandle: 'in',
    type: 'rope',
  };
}

export function toFlow(graph: WorkflowGraph): { nodes: FlowNode[]; edges: FlowEdge[] } {
  return { nodes: graph.nodes.map(toFlowNode), edges: graph.edges.map(toFlowEdge) };
}

/** Plain contract node (no React Flow internals). Config is normalised when it parses. */
export function toWorkflowNode(n: FlowNode, normalise = false): WorkflowNode {
  let config = n.data.config;
  if (normalise) {
    const parsed = nodeConfigSchemas[n.type].safeParse(config);
    if (parsed.success) config = parsed.data as Record<string, unknown>;
  }
  const data: WorkflowNode['data'] = { config: config as WorkflowNode['data']['config'] };
  const label = n.data.label?.trim();
  const notes = n.data.notes?.trim();
  if (label) data.label = label.slice(0, 80);
  if (notes) data.notes = notes.slice(0, 500);
  return {
    id: n.id,
    type: n.type,
    position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    data,
  };
}

export function toWorkflowEdge(e: FlowEdge): WorkflowEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? 'out',
    targetHandle: 'in',
  };
}

export function toGraph(
  nodes: FlowNode[],
  edges: FlowEdge[],
  version = 0,
  normalise = false,
): WorkflowGraph {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    version,
    nodes: nodes.map((n) => toWorkflowNode(n, normalise)),
    edges: edges.map(toWorkflowEdge),
  };
}

/** initialGraph > template whose key matches workflowId > empty graph. */
export function resolveInitialGraph(
  workflowId: string,
  initialGraph?: WorkflowGraph,
): { graph: WorkflowGraph; name: string; templateKey: string | null } {
  const tpl = WORKFLOW_TEMPLATES.find((t) => t.key === workflowId);
  if (initialGraph)
    return {
      graph: initialGraph,
      name: tpl?.name ?? 'Untitled workflow',
      templateKey: tpl?.key ?? null,
    };
  if (tpl) return { graph: tpl.graph, name: tpl.name, templateKey: tpl.key };
  return {
    graph: emptyGraph(),
    name: workflowId === 'new' ? 'New workflow' : 'Untitled workflow',
    templateKey: null,
  };
}

const rand = () => Math.random().toString(36).slice(2, 6);

export function newNodeId(type: NodeType, taken: Set<string>): string {
  const base = type.split('.')[1] ?? 'step';
  let id = `${base}_${rand()}`;
  while (taken.has(id)) id = `${base}_${rand()}`;
  return id;
}

/** Default config for a freshly added node: schema defaults plus sensible starters. */
export function defaultConfig(type: NodeType): Record<string, unknown> {
  const starters: Partial<Record<NodeType, Record<string, unknown>>> = {
    'trigger.inbound_webhook': { endpointId: '' },
    'trigger.schedule': { cron: '0 10 * * 1-6', leadFilter: { stageKeys: [], tags: [] } },
    'action.send_whatsapp_template': { templateName: '', language: 'en', variables: {} },
    'action.send_whatsapp_text': { body: 'Hi {{lead.firstName}}, ' },
    'action.send_email': { subject: '', body: 'Hi {{lead.firstName}},\n\n' },
    'action.send_sms': { body: '' },
    'action.create_task': {
      title: 'Follow up with {{lead.name}}',
      dueInMinutes: 60,
      priority: 'normal',
      assignTo: 'owner',
    },
    'action.assign_owner': {
      strategy: 'round_robin',
      userIds: [],
      rules: [],
      onlyIfUnassigned: true,
    },
    'action.add_tag': { tags: [] },
    'action.change_stage': { stageKey: '' },
    'action.update_field': { field: 'temperature', value: 'warm' },
    'action.outbound_webhook': { url: '', headers: {} },
    'logic.wait': { amount: 1, unit: 'hours', businessHoursOnly: true, resumeOnReply: false },
    'logic.condition': { kind: 'replied', since: 'last_outbound' },
    'logic.switch': {
      on: 'reply_keyword',
      cases: [{ key: 'price', label: 'Price', op: 'contains', value: ['price', 'rate'] }],
    },
    'logic.loop_limit': { max: 3 },
  };
  const start = starters[type] ?? {};
  const parsed = nodeConfigSchemas[type].safeParse(start);
  return parsed.success ? { ...(parsed.data as Record<string, unknown>) } : { ...start };
}
