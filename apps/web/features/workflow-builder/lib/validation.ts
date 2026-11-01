import { nodeConfigSchemas, validateGraph, type GraphIssue, type NodeType } from '@vistar/shared';
import type { ZodError } from 'zod';
import { displayLabel, toGraph, type FlowEdge, type FlowNode } from './graph';
import { pathLabel } from './labels';

type ZodIssue = ZodError['issues'][number];

export interface BuilderIssue extends GraphIssue {
  key: string;
  /** Message with the field name, for lists ("Template: Pick a template"). */
  text: string;
}

/** Turn a zod issue into copy that says what to do. */
export function friendlyZodMessage(issue: ZodIssue): string {
  const i = issue as ZodIssue & Record<string, unknown>;
  switch (issue.code) {
    case 'invalid_type':
      if (String(issue.message).includes('received undefined')) return 'Required';
      return i.expected === 'number'
        ? 'Enter a number'
        : i.expected === 'array'
          ? 'Add at least one value'
          : 'Enter a valid value';
    case 'too_small': {
      const min = Number(i.minimum);
      if (i.origin === 'string') return min <= 1 ? 'Required' : `Use at least ${min} characters`;
      if (i.origin === 'array' || i.origin === 'set')
        return min <= 1 ? 'Add at least one' : `Add at least ${min}`;
      return `Must be at least ${min}`;
    }
    case 'too_big': {
      const max = Number(i.maximum);
      if (i.origin === 'string') return `Use at most ${max} characters`;
      if (i.origin === 'array') return `Use at most ${max}`;
      return `Must be ${max} or less`;
    }
    case 'invalid_format':
      if (i.format === 'url')
        return 'Enter a full URL, for example https://example.com/hooks/vistar';
      if (i.format === 'regex') return 'Use lowercase letters, numbers and underscores only';
      return 'Check the format';
    case 'invalid_value':
      return 'Pick one of the options';
    case 'invalid_union':
      return 'Check this value';
    default:
      return issue.message;
  }
}

/** Field path -> friendly error for one node config. */
export function configErrors(
  type: NodeType,
  config: Record<string, unknown>,
): Record<string, string> {
  const parsed = nodeConfigSchemas[type].safeParse(config);
  const out: Record<string, string> = {};
  if (parsed.success) return out;
  for (const issue of parsed.error.issues) {
    const path = issue.path.map(String).join('.');
    if (!(path in out)) out[path] = friendlyZodMessage(issue);
  }
  return out;
}

/** validateGraph + friendly config messages (contract validation stays the source of truth). */
export function computeIssues(
  nodes: FlowNode[],
  edges: FlowEdge[],
  aiEnabled: boolean,
): BuilderIssue[] {
  const graph = toGraph(nodes, edges);
  const raw = validateGraph(graph, { aiEnabled });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cache = new Map<string, Record<string, string>>();
  return raw.map((issue, idx) => {
    let message = issue.message;
    const node = issue.nodeId ? byId.get(issue.nodeId) : undefined;
    if (node && issue.path !== null) {
      let errs = cache.get(node.id);
      if (!errs) {
        errs = configErrors(node.type, node.data.config);
        cache.set(node.id, errs);
      }
      message = errs[issue.path] ?? message;
    }
    const field = issue.path !== null ? pathLabel(issue.path || null) : null;
    const where = node ? displayLabel(node.type, node.data) : null;
    const text = [where, field ? `${field}: ${message}` : message].filter(Boolean).join(' · ');
    return {
      ...issue,
      message,
      text,
      key: `${idx}:${issue.nodeId ?? ''}:${issue.edgeId ?? ''}:${issue.path ?? ''}`,
    };
  });
}

export function issueCounts(issues: BuilderIssue[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const i of issues) {
    if (i.severity === 'error') errors++;
    else warnings++;
  }
  return { errors, warnings };
}
