import { NODE_CATALOG, NODE_TYPES, type ChipTone, type NodeCategory, type NodeDefinition, type NodeType } from '@vistar/shared';
import {
  Box,
  CalendarClock,
  CircleStop,
  Columns3,
  Contact,
  CopyCheck,
  GitBranch,
  Globe,
  Hourglass,
  ListTodo,
  Mail,
  MessageCircle,
  MessageSquare,
  MessageSquareText,
  MoveRight,
  PencilLine,
  PhoneMissed,
  PhoneOutgoing,
  Repeat,
  Send,
  Smartphone,
  Sparkles,
  Split,
  Store,
  Tag,
  UserCheck,
  UserPlus,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

/** Static icon map (tree-shakeable) for the lucide names used by NODE_CATALOG. */
const ICONS: Record<string, LucideIcon> = {
  Store,
  Globe,
  Webhook,
  MessageCircle,
  UserPlus,
  Columns3,
  PhoneMissed,
  CalendarClock,
  Contact,
  MessageSquareText,
  MessageSquare,
  Mail,
  Smartphone,
  ListTodo,
  PhoneOutgoing,
  UserCheck,
  Tag,
  MoveRight,
  PencilLine,
  Send,
  Hourglass,
  GitBranch,
  Split,
  CopyCheck,
  Repeat,
  CircleStop,
  Sparkles,
};

export function nodeIcon(type: NodeType): LucideIcon {
  return ICONS[NODE_CATALOG[type].icon] ?? Box;
}

export const CATEGORY_ORDER: readonly NodeCategory[] = ['trigger', 'action', 'logic', 'ai'];

export const CATEGORY_META: Record<NodeCategory, { label: string; plural: string; tone: ChipTone }> = {
  trigger: { label: 'Trigger', plural: 'Triggers', tone: 'indigo' },
  action: { label: 'Action', plural: 'Actions', tone: 'blue' },
  logic: { label: 'Logic', plural: 'Logic', tone: 'amber' },
  ai: { label: 'AI', plural: 'AI', tone: 'grey' },
};

/** Tailwind classes per category tone (status tokens; literal strings so Tailwind can see them). */
export const TONE_CLASSES: Record<NodeCategory, { chip: string; lip: string; mini: string }> = {
  trigger: {
    chip: 'border-status-indigo-border bg-status-indigo-bg text-status-indigo-fg',
    lip: 'bg-status-indigo-border',
    mini: 'var(--status-indigo-fg)',
  },
  action: {
    chip: 'border-status-blue-border bg-status-blue-bg text-status-blue-fg',
    lip: 'bg-status-blue-border',
    mini: 'var(--status-blue-fg)',
  },
  logic: {
    chip: 'border-status-amber-border bg-status-amber-bg text-status-amber-fg',
    lip: 'bg-status-amber-border',
    mini: 'var(--status-amber-fg)',
  },
  ai: {
    chip: 'border-status-grey-border bg-status-grey-bg text-status-grey-fg',
    lip: 'bg-status-grey-border',
    mini: 'var(--status-grey-fg)',
  },
};

export function categoryOf(type: NodeType): NodeCategory {
  return NODE_CATALOG[type].category;
}

export function isTrigger(type: NodeType): boolean {
  return NODE_CATALOG[type].category === 'trigger';
}

/** Output handle ids for a node config (contract: NODE_CATALOG[type].outputs). */
export function outputsOf(type: NodeType, config: Record<string, unknown>): string[] {
  try {
    return NODE_CATALOG[type].outputs(config);
  } catch {
    return [];
  }
}

/** Palette entries, optionally hiding feature-flagged (AI) nodes. */
export function paletteDefinitions(aiEnabled: boolean): NodeDefinition[] {
  return NODE_TYPES.map((t) => NODE_CATALOG[t]).filter((d) => aiEnabled || d.featureFlag !== 'FEATURE_AI_NODE');
}

/** Human label for an output handle given the node config. */
export function handleLabel(type: NodeType, config: Record<string, unknown>, handle: string): string {
  if (handle === 'out') return 'Next';
  if (handle === 'default') return 'Default';
  if (type === 'logic.switch') {
    const c = (config.cases as Array<{ key: string; label?: string }> | undefined)?.find((x) => x.key === handle);
    if (c?.label) return c.label;
  }
  const known: Record<string, string> = {
    yes: 'Yes',
    no: 'No',
    unique: 'Unique',
    duplicate: 'Duplicate',
    exceeded: 'Exceeded',
  };
  if (known[handle]) return known[handle];
  const s = handle.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
