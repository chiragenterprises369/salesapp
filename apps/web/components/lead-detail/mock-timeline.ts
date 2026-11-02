import type { Activity, Lead, Task, UserSummary } from '@vistar/shared';
import { tasksForLead, timelineForLead } from '@/lib/world';

/**
 * Timeline and tasks of a lead from the mock world (Wave 1): calls, WhatsApp messages, notes, emails,
 * files, stage changes, assignments, workflow steps and tasks that belong to this lead. Shapes match
 * ActivitySchema / TaskSchema, so the components work unchanged when GET /leads/{id}/timeline and
 * GET /tasks?leadId= land. Leads created in this tab are not in the world: they get their creation
 * and assignment only (later edits add local activities on top).
 */
export function mockTimeline(lead: Lead, _users: UserSummary[], now = Date.now()): Activity[] {
  const generated = timelineForLead(lead).filter((a) => Date.parse(a.createdAt) <= now);
  if (generated.length) return generated;
  const out: Activity[] = [
    { id: `${lead.id}:created`, leadId: lead.id, type: 'lead_created', actor: lead.source === 'manual' ? lead.owner : null, createdAt: lead.createdAt, payload: { source: lead.source } },
  ];
  if (lead.owner) {
    out.unshift({ id: `${lead.id}:assigned`, leadId: lead.id, type: 'assigned', actor: null, createdAt: lead.createdAt, payload: { fromUserId: null, toUserId: lead.owner.id, rule: null } });
  }
  return out;
}

/** Open tasks first (by due time), then done and cancelled ones (latest first). */
export function mockTasks(lead: Lead, _now = Date.now()): Task[] {
  return [...tasksForLead(lead.id)].sort((a, b) => {
    if (a.status === 'open' && b.status !== 'open') return -1;
    if (b.status === 'open' && a.status !== 'open') return 1;
    if (a.status === 'open') return (a.dueAt ?? '').localeCompare(b.dueAt ?? '');
    return (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt);
  });
}
