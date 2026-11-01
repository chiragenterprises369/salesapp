import type { NodeType } from '@vistar/shared';
import { createElement } from 'react';
import { nodeIcon } from '../lib/catalog';

/** Lucide icon for a node type (NODE_CATALOG[type].icon). */
export function NodeIcon({ type, className }: { type: NodeType; className?: string }) {
  return createElement(nodeIcon(type), { className, 'aria-hidden': true });
}
