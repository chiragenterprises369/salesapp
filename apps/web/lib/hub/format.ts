import type { ChipTone } from '@vistar/shared';

/**
 * Labels and chip tones for the hub pages. Keyed by string so a status the API adds later still
 * renders (falls back to the raw value in a neutral chip).
 */
type Tone = { label: string; tone: ChipTone };

export const INTEGRATION_STATUS: Record<string, Tone> = {
  connected: { label: 'Connected', tone: 'green' },
  needs_attention: { label: 'Needs attention', tone: 'amber' },
  error: { label: 'Error', tone: 'red' },
  not_connected: { label: 'Not connected', tone: 'grey' },
  disconnected: { label: 'Not connected', tone: 'grey' },
  not_configured: { label: 'Not available', tone: 'grey' },
};

export const DELIVERY_STATUS: Record<string, Tone> = {
  pending: { label: 'Pending', tone: 'blue' },
  retrying: { label: 'Retrying', tone: 'amber' },
  success: { label: 'Delivered', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  dead: { label: 'Dead letter', tone: 'red' },
  duplicate: { label: 'Duplicate', tone: 'grey' },
  rejected: { label: 'Rejected', tone: 'red' },
};

export const statusOf = (map: Record<string, Tone>, value: string | null | undefined): Tone => (value && map[value]) || { label: value ? value.replace(/_/g, ' ') : 'Unknown', tone: 'neutral' };

/** Human label of an outbound event ("stage.changed" -> "Stage changed"). */
export function eventLabel(event: string): string {
  const known: Record<string, string> = {
    'lead.created': 'Lead created',
    'lead.updated': 'Lead updated',
    'lead.assigned': 'Lead assigned',
    'stage.changed': 'Lead stage changed',
    'call.ended': 'Call ended',
    'message.received': 'WhatsApp message received',
    'task.overdue': 'Task overdue',
    'workflow.failed': 'Workflow failed',
    'contact.created': 'Contact created',
    'account.created': 'Account created',
    'deal.created': 'Deal created',
    'deal.won': 'Deal won',
    'deal.lost': 'Deal lost',
    'quotation.sent': 'Quotation sent',
    'quotation.accepted': 'Quotation accepted',
    'invoice.issued': 'Invoice issued',
    'invoice.paid': 'Invoice paid',
    'meeting.scheduled': 'Meeting scheduled',
  };
  if (known[event]) return known[event]!;
  const words = event.replace(/[._]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "Lead", "Call" ... group of an event for the checklist ("lead.created" -> "lead"). */
export const eventGroup = (event: string) => event.split('.')[0] ?? event;

export const EVENT_GROUP_LABEL: Record<string, string> = {
  lead: 'Leads',
  stage: 'Leads',
  call: 'Calls',
  message: 'WhatsApp',
  task: 'Tasks',
  workflow: 'Workflows',
  contact: 'Contacts',
  account: 'Accounts',
  deal: 'Deals',
  quotation: 'Quotations',
  invoice: 'Invoices',
  meeting: 'Calendar',
};

/** "120 ms", "2.4 s". */
export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

/** "in 5 min", "in 2 h" for a future instant (retry schedule). */
export function inFuture(iso: string | null | undefined, now: number): string {
  if (!iso || !now) return '';
  const s = Math.round((new Date(iso).getTime() - now) / 1000);
  if (s <= 0) return 'now';
  if (s < 60) return `in ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h} h`;
  const d = Math.round(h / 24);
  return `in ${d} ${d === 1 ? 'day' : 'days'}`;
}

/** "1 min", "5 min", "30 min", "2 h", "6 h", "1 day" for the retry schedule. */
export function formatDelay(sec: number): string {
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 86_400) return `${Math.round(sec / 3600)} h`;
  const d = Math.round(sec / 86_400);
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

/** HTTP status tone for the delivery log. */
export function httpTone(status: number | null | undefined): ChipTone {
  if (!status) return 'grey';
  if (status < 300) return 'green';
  if (status < 500) return 'amber';
  return 'red';
}
