import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TARGET_METRICS } from '../../enums.js';
import { ActivitySchema } from '../../schemas/activity.js';
import { CallSchema } from '../../schemas/call.js';
import { ConversationSchema, MessageSchema } from '../../schemas/conversation.js';
import {
  IntegrationSchema,
  WebhookDeliverySchema,
  WebhookEndpointSchema,
} from '../../schemas/integration.js';
import { SavedViewSchema } from '../../schemas/lead.js';
import { AuditLogSchema, NotificationSchema } from '../../schemas/notification.js';
import {
  CompanySchema,
  ImpersonationSessionSchema,
  PlanDefinitionSchema,
  PlatformAuditLogSchema,
  PlatformOverviewSchema,
  UsageSnapshotSchema,
} from '../../schemas/platform.js';
import { TaskSchema } from '../../schemas/task.js';
import { WorkflowRunSchema } from '../../schemas/workflow.js';
import { COMPANY_FIXTURES } from '../india.js';
import { mockLeads } from '../mock.js';
import {
  buildWorld,
  DAY_MS,
  istDayStart,
  istPeriod,
  MOCK_LEAD_COUNT,
  MOCK_LEAD_SEED,
  worldLeadDetails,
  worldLeads,
  worldTimelineFor,
  worldWorkflowRun,
} from '../world.js';

/** Monday 2 Nov 2026, 1 pm IST. */
const NOW = Date.parse('2026-11-02T13:00:00+05:30');
const world = buildWorld({ now: NOW });
const { ctx } = world;
const endOfToday = istDayStart(NOW) + DAY_MS;
const rep1 = ctx.users.find((u) => u.name === 'Rohit Verma')!;

describe('IST calendar helpers', () => {
  it('finds the workspace day and month', () => {
    expect(new Date(istDayStart(NOW)).toISOString()).toBe('2026-11-01T18:30:00.000Z');
    expect(istPeriod(NOW)).toBe('2026-11');
    expect(istPeriod(Date.parse('2026-10-31T19:00:00Z'))).toBe('2026-11');
  });
});

describe('leads', () => {
  it('has 2,500 leads with ids from the unchanged generator', () => {
    expect(MOCK_LEAD_COUNT).toBe(2500);
    expect(world.leads).toHaveLength(MOCK_LEAD_COUNT);
    expect(world.leads.map((l) => l.id)).toEqual(
      mockLeads(MOCK_LEAD_COUNT, MOCK_LEAD_SEED).map((l) => l.id),
    );
    // The first 240 are the leads earlier mocks used, and ids do not depend on `now`.
    expect(world.leads.slice(0, 240).map((l) => l.id)).toEqual(mockLeads(240, 7).map((l) => l.id));
    expect(worldLeads(NOW + 9 * DAY_MS).map((l) => l.id)).toEqual(world.leads.map((l) => l.id));
  });

  it('never has activity after now', () => {
    expect(world.leads.every((l) => !l.lastActivityAt || Date.parse(l.lastActivityAt) <= NOW)).toBe(
      true,
    );
  });

  it('has lead details that match the generic-sales fields', () => {
    const d = worldLeadDetails(world.leads[0]!);
    expect(d.productInterest).toBeTruthy();
    if (d.customFields.gst_number)
      expect(d.customFields.gst_number).toMatch(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/);
    if (d.customFields.delivery_by)
      expect(d.customFields.delivery_by).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('schemas', () => {
  it('tasks, calls, conversations and messages match the shared schemas', () => {
    z.array(TaskSchema).parse(world.tasks);
    z.array(CallSchema).parse(world.calls);
    z.array(ConversationSchema).parse(world.inbox.conversations);
    z.array(MessageSchema).parse([...world.inbox.messagesByConversation.values()].flat());
  });

  it('timelines, notifications, audit log, runs and saved views match the shared schemas', () => {
    for (const lead of world.leads.slice(0, 60))
      z.array(ActivitySchema).parse(worldTimelineFor(ctx, lead));
    for (const list of world.notifications.values()) z.array(NotificationSchema).parse(list);
    z.array(AuditLogSchema).parse(world.audit);
    z.array(WorkflowRunSchema).parse(world.runs);
    z.array(SavedViewSchema).parse(world.savedViews);
    for (const r of world.runs.slice(0, 40)) WorkflowRunSchema.parse(worldWorkflowRun(ctx, r.id));
  });

  it('integrations, webhooks, billing and platform data match the shared schemas', () => {
    z.array(IntegrationSchema).parse(world.integrations);
    z.array(WebhookEndpointSchema).parse(world.webhooks);
    z.array(WebhookDeliverySchema).parse(world.deliveries);
    UsageSnapshotSchema.parse(world.billing.usage);
    PlanDefinitionSchema.parse(world.billing.plan);
    z.array(PlanDefinitionSchema).parse(world.platform.plans);
    z.array(CompanySchema).parse(world.platform.companies.map((c) => c.company));
    z.array(PlatformAuditLogSchema).parse(world.platform.audit);
    z.array(ImpersonationSessionSchema).parse(world.platform.support);
    PlatformOverviewSchema.parse(world.platform.overview);
  });
});

describe('determinism', () => {
  it('gives the same world for the same now', () => {
    const again = buildWorld({ now: NOW });
    expect(again.tasks.map((t) => t.id)).toEqual(world.tasks.map((t) => t.id));
    expect(again.calls.slice(0, 200)).toEqual(world.calls.slice(0, 200));
    expect(again.inbox.conversations.slice(0, 50)).toEqual(world.inbox.conversations.slice(0, 50));
    expect(again.runs.map((r) => r.id)).toEqual(world.runs.map((r) => r.id));
    expect([...again.notifications.get(rep1.id)!]).toEqual([...world.notifications.get(rep1.id)!]);
  });

  it('keeps task ids when the day moves on', () => {
    const later = buildWorld({ now: NOW + 3 * 60 * 60_000 });
    const ids = new Set(later.tasks.map((t) => t.id));
    expect(world.tasks.filter((t) => ids.has(t.id)).length / world.tasks.length).toBeGreaterThan(
      0.95,
    );
  });
});

describe('links between records', () => {
  it('tasks, calls, chats and runs point at real leads and their owners', () => {
    for (const t of world.tasks) {
      if (!t.leadId) continue;
      const lead = ctx.leadById.get(t.leadId)!;
      expect(lead).toBeDefined();
      expect(t.assignee?.id).toBe(lead.owner?.id);
    }
    for (const c of world.calls)
      if (c.leadId) expect(ctx.leadById.get(c.leadId)?.owner?.id).toBe(c.user?.id);
    for (const c of world.inbox.conversations)
      expect(c.assignee?.id ?? null).toBe(ctx.leadById.get(c.leadId!)?.owner?.id ?? null);
    for (const r of world.runs) if (r.leadId) expect(ctx.leadById.has(r.leadId)).toBe(true);
  });
});

describe('day-relative data (fixed now)', () => {
  it('gives the signed-in employee a full day', () => {
    const open = world.tasks.filter(
      (t) =>
        t.assignee?.id === rep1.id &&
        t.status === 'open' &&
        t.dueAt &&
        Date.parse(t.dueAt) < endOfToday,
    );
    const calls = open.filter((t) => t.type === 'call');
    expect(calls.length).toBeGreaterThanOrEqual(8);
    expect(open.length - calls.length).toBeGreaterThanOrEqual(8);
    expect(open.some((t) => Date.parse(t.dueAt!) < NOW)).toBe(true);
    expect(world.tasks.some((t) => t.assignee?.id === rep1.id && t.status === 'done')).toBe(true);
  });

  it('has calls of the last 30 days, none in the future, and live calls for on-call staff', () => {
    expect(world.calls.length).toBeGreaterThan(3000);
    for (const c of world.calls) {
      const t = Date.parse(c.startedAt);
      expect(t).toBeLessThanOrEqual(NOW);
      expect(t).toBeGreaterThan(NOW - 31 * DAY_MS);
    }
    expect(
      world.calls.some((c) => c.direction === 'inbound') &&
        world.calls.some((c) => c.status === 'missed'),
    ).toBe(true);
    expect(world.calls.some((c) => c.hasRecording && c.notes && c.disposition)).toBe(true);
    const live = world.calls.filter((c) => c.status === 'in_progress');
    expect(live.map((c) => c.user?.id).sort()).toEqual(
      ctx.sellers
        .filter((s) => s.status === 'on_call')
        .map((s) => s.id)
        .sort(),
    );
    expect(
      world.calls.filter(
        (c) => c.user?.id === rep1.id && Date.parse(c.startedAt) >= istDayStart(NOW),
      ).length,
    ).toBeGreaterThan(0);
  });

  it('has WhatsApp chats for about 40% of leads with real statuses and the 24 h window', () => {
    const share = world.inbox.conversations.length / world.leads.length;
    expect(share).toBeGreaterThan(0.35);
    expect(share).toBeLessThan(0.5);
    const msgs = [...world.inbox.messagesByConversation.values()].flat();
    for (const s of ['delivered', 'read', 'failed'] as const)
      expect(msgs.some((m) => m.status === s)).toBe(true);
    expect(msgs.some((m) => m.type === 'template' && m.templateName)).toBe(true);
    expect(world.inbox.conversations.some((c) => c.unreadCount > 0)).toBe(true);
    for (const c of world.inbox.conversations) {
      if (c.lastInboundAt)
        expect(Date.parse(c.windowExpiresAt!) - Date.parse(c.lastInboundAt)).toBe(24 * 60 * 60_000);
      else expect(c.windowExpiresAt).toBeNull();
    }
  });

  it('builds ordered timelines with created, assigned and stage changes', () => {
    const lead = world.leads.find(
      (l) => l.owner && ctx.stageById.get(l.stageId)?.key === 'quote_sent',
    )!;
    const tl = worldTimelineFor(ctx, lead);
    expect(tl.map((a) => a.createdAt)).toEqual([...tl.map((a) => a.createdAt)].sort().reverse());
    const types = new Set(tl.map((a) => a.type));
    for (const t of ['lead_created', 'assigned', 'stage_changed', 'note'] as const)
      expect(types.has(t)).toBe(true);
    expect(tl.every((a) => Date.parse(a.createdAt) <= NOW)).toBe(true);
  });

  it('gives every user 25-40 notifications, read and unread', () => {
    for (const u of ctx.users) {
      const list = world.notifications.get(u.id)!;
      expect(list.length).toBeGreaterThanOrEqual(25);
      expect(list.length).toBeLessThanOrEqual(40);
      expect(list.some((n) => n.readAt === null)).toBe(true);
      expect(list.some((n) => n.readAt !== null)).toBe(true);
    }
  });

  it('has monthly targets for every seller and team, this month and last', () => {
    const periods = new Set(world.targets.map((t) => t.period));
    expect([...periods].sort()).toEqual(['2026-10', '2026-11']);
    for (const subject of [...ctx.sellers.map((s) => s.id), ...ctx.teams.map((t) => t.id)]) {
      expect(world.targets.filter((t) => t.subjectId === subject)).toHaveLength(
        TARGET_METRICS.length * 2,
      );
    }
    const last = world.targets.filter((t) => t.period === '2026-10' && t.metric === 'calls');
    expect(last.every((t) => t.achieved > 0 && t.target > 0)).toBe(true);
  });
});

describe('operations and platform', () => {
  it('logs the sensitive actions the audit log must show', () => {
    const actions = new Set(world.audit.map((a) => a.action));
    for (const a of [
      'user.role_change',
      'leads.export',
      'settings.business_hours.update',
      'impersonation.start',
      'plan.change',
    ])
      expect(actions.has(a)).toBe(true);
    expect(world.audit.some((a) => a.actorType === 'super_admin')).toBe(true);
  });

  it('has workflow runs that succeed, fail and wait, with steps', () => {
    const statuses = new Set(world.runs.map((r) => r.status));
    for (const s of ['completed', 'failed', 'waiting'] as const) expect(statuses.has(s)).toBe(true);
    const failed = worldWorkflowRun(ctx, world.runs.find((r) => r.status === 'failed')!.id)!;
    expect(failed.steps![0]!.nodeType.startsWith('trigger.')).toBe(true);
    expect(failed.steps!.at(-1)!.status).toBe('failed');
    const waiting = worldWorkflowRun(ctx, world.runs.find((r) => r.status === 'waiting')!.id)!;
    expect(waiting.steps!.at(-1)!.status).toBe('waiting');
    expect(waiting.currentNodeIds).toHaveLength(1);
  });

  it('has a company directory across plans and statuses', () => {
    const companies = world.platform.companies.map((c) => c.company);
    expect(companies.length).toBeGreaterThanOrEqual(23);
    for (const f of COMPANY_FIXTURES) expect(companies.some((c) => c.slug === f.slug)).toBe(true);
    expect(new Set(companies.map((c) => c.plan)).size).toBe(4);
    for (const s of ['active', 'trial', 'suspended'] as const)
      expect(companies.some((c) => c.status === s)).toBe(true);
    expect(world.platform.overview.signups30d).toBeGreaterThan(0);
    expect(world.platform.health.length).toBeGreaterThan(5);
    expect(world.platform.support.filter((s) => s.endedAt === null)).toHaveLength(1);
  });
});
