import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from './graph.js';
import { GRAPH_SCHEMA_VERSION } from './graph.js';
import type { NodeConfig, NodeType } from './nodes.js';

/**
 * Shipped workflow templates. Referenced WhatsApp templates are listed in
 * WHATSAPP_TEMPLATE_FIXTURES (fixtures) and seeded as approved.
 * Grid: 300px columns, 150px rows.
 */
const X = 300;
const Y = 150;

function n<T extends NodeType>(id: string, type: T, col: number, row: number, config: NodeConfig<T>, label?: string): WorkflowNode<T> {
  return { id, type, position: { x: col * X, y: row * Y }, data: { config, ...(label ? { label } : {}) } };
}
function e(source: string, target: string, sourceHandle = 'out'): WorkflowEdge {
  return { id: `${source}-${sourceHandle}-${target}`, source, target, sourceHandle, targetHandle: 'in' };
}
function graph(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowGraph {
  return { schemaVersion: GRAPH_SCHEMA_VERSION, version: 0, nodes, edges };
}

export interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
}

const indiamartNurturing: WorkflowTemplate = {
  key: 'indiamart_nurturing',
  name: 'IndiaMART nurturing',
  description: 'Dedupe, create contact and deal, send welcome, branch on reply intent, follow up and create a call task.',
  graph: graph(
    [
      n('trigger', 'trigger.indiamart_lead', 0, 0, {}),
      n('dedupe', 'logic.dedupe', 0, 1, { matchBy: ['phone', 'sourceRef'], withinDays: 90 }),
      n('stop_dup', 'logic.stop', 1, 2, { reason: 'Duplicate enquiry' }, 'Stop: duplicate'),
      n('contact', 'action.upsert_contact', 0, 2, { createDeal: true, dealValueInr: null }, 'Create contact + deal'),
      n('assign', 'action.assign_owner', 0, 3, { strategy: 'round_robin', userIds: [], rules: [], onlyIfUnassigned: true }),
      n('welcome', 'action.send_whatsapp_template', 0, 4, {
        templateName: 'indiamart_welcome',
        language: 'en',
        variables: { '1': '{{lead.firstName}}', '2': '{{workspace.name}}', '3': '{{lead.productInterest}}' },
      }, 'WhatsApp welcome'),
      n('wait_2h', 'logic.wait', 0, 5, { amount: 2, unit: 'hours', businessHoursOnly: true, resumeOnReply: true }),
      n('replied', 'logic.condition', 0, 6, { kind: 'replied', since: 'last_outbound' }, 'Replied?'),
      n('intent', 'logic.switch', -1, 7, {
        on: 'reply_keyword',
        cases: [
          { key: 'price', label: 'Price', op: 'contains', value: ['price', 'rate', 'cost', 'kitna', 'quotation', 'quote'] },
          { key: 'catalog', label: 'Catalog', op: 'contains', value: ['catalog', 'catalogue', 'brochure', 'details', 'photos'] },
          { key: 'not_interested', label: 'Not interested', op: 'contains', value: ['not interested', 'no need', 'stop', 'nahi'] },
        ],
      }, 'Intent'),
      n('price_list', 'action.send_whatsapp_template', -2, 8, { templateName: 'price_list', language: 'en', variables: { '1': '{{lead.firstName}}' } }, 'Send price list'),
      n('price_task', 'action.create_task', -2, 9, {
        title: 'Follow up on price enquiry: {{lead.name}}',
        dueInMinutes: 60,
        priority: 'high',
        assignTo: 'owner',
      }, 'Task for rep'),
      n('catalog', 'action.send_whatsapp_template', -1, 8, { templateName: 'product_catalog', language: 'en', variables: { '1': '{{lead.firstName}}' } }, 'Send catalog'),
      n('mark_lost', 'action.change_stage', 0, 8, { stageKey: 'lost' }, 'Mark lost'),
      n('other_task', 'action.create_task', 1, 8, { title: 'Reply to {{lead.name}}', dueInMinutes: 30, priority: 'normal', assignTo: 'owner' }, 'Task: reply'),
      n('wait_1d', 'logic.wait', 2, 7, { amount: 1, unit: 'days', businessHoursOnly: true, resumeOnReply: false }),
      n('followup_1', 'action.send_whatsapp_template', 2, 8, { templateName: 'indiamart_followup_1', language: 'en', variables: { '1': '{{lead.firstName}}' } }, 'Follow-up 1'),
      n('wait_2d', 'logic.wait', 2, 9, { amount: 2, unit: 'days', businessHoursOnly: true, resumeOnReply: false }),
      n('call_task', 'action.create_call_task', 2, 10, { title: 'Call {{lead.name}} (no reply on WhatsApp)', dueInMinutes: 30, priority: 'high' }),
      n('mark_cold', 'action.update_field', 2, 11, { field: 'temperature', value: 'cold' }, 'Mark cold'),
    ],
    [
      e('trigger', 'dedupe'),
      e('dedupe', 'contact', 'unique'),
      e('dedupe', 'stop_dup', 'duplicate'),
      e('contact', 'assign'),
      e('assign', 'welcome'),
      e('welcome', 'wait_2h'),
      e('wait_2h', 'replied'),
      e('replied', 'intent', 'yes'),
      e('replied', 'wait_1d', 'no'),
      e('intent', 'price_list', 'price'),
      e('price_list', 'price_task'),
      e('intent', 'catalog', 'catalog'),
      e('intent', 'mark_lost', 'not_interested'),
      e('intent', 'other_task', 'default'),
      e('wait_1d', 'followup_1'),
      e('followup_1', 'wait_2d'),
      e('wait_2d', 'call_task'),
      e('call_task', 'mark_cold'),
    ],
  ),
};

const missedCallFollowUp: WorkflowTemplate = {
  key: 'missed_call_follow_up',
  name: 'Missed-call follow-up',
  description: 'Message the caller on WhatsApp and create an urgent call-back task.',
  graph: graph(
    [
      n('trigger', 'trigger.call_missed', 0, 0, {}),
      n('sorry', 'action.send_whatsapp_template', 0, 1, { templateName: 'missed_call_sorry', language: 'en', variables: { '1': '{{lead.firstName}}', '2': '{{workspace.name}}' } }),
      n('callback', 'action.create_call_task', 0, 2, { title: 'Call back {{lead.name}} (missed call)', dueInMinutes: 15, priority: 'urgent' }),
      n('wait', 'logic.wait', 0, 3, { amount: 2, unit: 'hours', businessHoursOnly: true, resumeOnReply: true }),
      n('replied', 'logic.condition', 0, 4, { kind: 'replied', since: 'last_outbound' }, 'Replied?'),
      n('tag', 'action.add_tag', 1, 5, { tags: ['missed-call-no-reply'] }),
      n('done', 'logic.stop', -1, 5, {}),
    ],
    [e('trigger', 'sorry'), e('sorry', 'callback'), e('callback', 'wait'), e('wait', 'replied'), e('replied', 'done', 'yes'), e('replied', 'tag', 'no')],
  ),
};

const quoteReminder: WorkflowTemplate = {
  key: 'quote_reminder',
  name: 'Quote reminder',
  description: 'Remind the lead two days after a quote, then create a call task if still pending.',
  graph: graph(
    [
      n('trigger', 'trigger.stage_changed', 0, 0, { toStageKey: 'quote_sent' }),
      n('wait_2d', 'logic.wait', 0, 1, { amount: 2, unit: 'days', businessHoursOnly: true, resumeOnReply: false }),
      n('still_quote', 'logic.condition', 0, 2, { kind: 'field', rule: { field: 'lead.stageKey', op: 'eq', value: 'quote_sent' } }, 'Still in Quote sent?'),
      n('reminder', 'action.send_whatsapp_template', 0, 3, { templateName: 'quote_reminder', language: 'en', variables: { '1': '{{lead.firstName}}' } }),
      n('wait_3d', 'logic.wait', 0, 4, { amount: 3, unit: 'days', businessHoursOnly: true, resumeOnReply: true }),
      n('still_quote_2', 'logic.condition', 0, 5, { kind: 'field', rule: { field: 'lead.stageKey', op: 'eq', value: 'quote_sent' } }, 'Still pending?'),
      n('call_task', 'action.create_call_task', 0, 6, { title: 'Discuss quote with {{lead.name}}', dueInMinutes: 60, priority: 'high' }),
      n('stop_moved', 'logic.stop', 1, 3, { reason: 'Lead moved on' }),
      n('stop_moved_2', 'logic.stop', 1, 6, { reason: 'Lead moved on' }),
    ],
    [
      e('trigger', 'wait_2d'),
      e('wait_2d', 'still_quote'),
      e('still_quote', 'reminder', 'yes'),
      e('still_quote', 'stop_moved', 'no'),
      e('reminder', 'wait_3d'),
      e('wait_3d', 'still_quote_2'),
      e('still_quote_2', 'call_task', 'yes'),
      e('still_quote_2', 'stop_moved_2', 'no'),
    ],
  ),
};

const inactiveRevival: WorkflowTemplate = {
  key: 'inactive_lead_revival',
  name: 'Inactive lead revival',
  description: 'Every Monday, re-engage leads with no activity for 30 days.',
  graph: graph(
    [
      n('trigger', 'trigger.schedule', 0, 0, { cron: '0 11 * * 1', leadFilter: { stageKeys: ['contacted', 'interested'], inactiveDays: 30, tags: [] } }),
      n('offer', 'action.send_whatsapp_template', 0, 1, { templateName: 'revival_offer', language: 'en', variables: { '1': '{{lead.firstName}}' } }),
      n('wait', 'logic.wait', 0, 2, { amount: 3, unit: 'days', businessHoursOnly: true, resumeOnReply: true }),
      n('replied', 'logic.condition', 0, 3, { kind: 'replied', since: 'last_outbound' }, 'Replied?'),
      n('revived', 'action.add_tag', -1, 4, { tags: ['revived'] }),
      n('task', 'action.create_task', -1, 5, { title: '{{lead.name}} replied to revival offer', dueInMinutes: 60, priority: 'high', assignTo: 'owner' }),
      n('dormant', 'action.add_tag', 1, 4, { tags: ['dormant'] }),
    ],
    [e('trigger', 'offer'), e('offer', 'wait'), e('wait', 'replied'), e('replied', 'revived', 'yes'), e('revived', 'task'), e('replied', 'dormant', 'no')],
  ),
};

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [indiamartNurturing, missedCallFollowUp, quoteReminder, inactiveRevival];
