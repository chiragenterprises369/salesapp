/**
 * Workspace-level demo rows derived from the lead history: notifications, targets, saved views, tags,
 * quick replies, integrations, webhooks + deliveries, API keys, usage counters, audit log, settings and
 * invites. Secrets are random, encrypted or hashed exactly like the API modules do, and never printed.
 */
import { API_KEY_PREFIX, SETTING_KEYS, WEBHOOK_RETRY_DELAYS_SEC, type ApiKeyScope, type NotificationType, type OutboundWebhookEvent } from '@vistar/shared';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { encryptSecret, hashToken, randomToken } from '../../src/infra/crypto/secrets.js';
import type { CompanyCtx, SeedUser } from './company.js';
import * as C from './content.js';
import type { History } from './history.js';
import { addDays, between, chance, d, DAY, fill, firstName, HOUR, int, iso, istWeekday, MIN, monthKey, pick, shuffle, startOfDay } from './util.js';

type Json = Prisma.InputJsonValue;
const SEC = 1000;

export interface Extras {
  notifications: Prisma.NotificationCreateManyInput[];
  targets: Prisma.TargetCreateManyInput[];
  savedViews: Prisma.SavedViewCreateManyInput[];
  tags: Prisma.TagCreateManyInput[];
  quickReplies: Prisma.QuickReplyCreateManyInput[];
  integrations: Prisma.IntegrationCreateManyInput[];
  endpoints: Prisma.WebhookEndpointCreateManyInput[];
  deliveries: Prisma.WebhookDeliveryCreateManyInput[];
  apiKeys: Prisma.ApiKeyCreateManyInput[];
  usage: Prisma.UsageCounterCreateManyInput[];
  audit: Prisma.AuditLogCreateManyInput[];
  settings: Prisma.SettingCreateManyInput[];
  invites: Prisma.InviteCreateManyInput[];
}

/** Same masking as AuditService.maskDiff for e-mails. */
export const maskEmail = (email: string) => {
  const [local, domain] = email.split('@');
  return `${(local ?? '').slice(0, 1)}***@${domain ?? ''}`;
};
const SOURCE_LABEL: Record<string, string> = { indiamart: 'IndiaMART', website: 'Website', whatsapp: 'WhatsApp', manual: 'Manual', webhook: 'Webhook', import: 'Import', api: 'API' };
const time = (at: number) => new Date(at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
const roundTo = (v: number, step: number) => Math.max(step, Math.round(v / step) * step);

export function buildExtras(ctx: CompanyCtx, h: History): Extras {
  const { rng, now, workspaceId } = ctx;
  const x: Extras = { notifications: [], targets: [], savedViews: [], tags: [], quickReplies: [], integrations: [], endpoints: [], deliveries: [], apiKeys: [], usage: [], audit: [], settings: [], invites: [] };
  const leadById = new Map(h.states.map((s) => [s.id, s]));
  const stageId = (key: string) => ctx.stages.find((s) => s.key === key)!.id;
  const teamOf = (u: SeedUser) => ctx.teams.find((t) => t.id === u.teamId);
  const managerOf = (u: SeedUser) => {
    const t = teamOf(u);
    return t && t.managerId !== u.id ? ctx.userById.get(t.managerId)! : u.kind === 'manager' || u.kind === 'viewer' ? ctx.admin : (ctx.managers[0] ?? ctx.admin);
  };

  // ------------------------------------------------------------ notifications (25-40 per user)
  for (const u of ctx.users) {
    const prefix = u.kind === 'employee' ? '/me' : '/app';
    type Cand = { at: number; type: NotificationType; title: string; body: string | null; path: string; data: Json };
    const buckets = new Map<NotificationType, Cand[]>();
    const add = (c: Cand) => {
      if (c.at > now || c.at < now - 30 * DAY) return;
      const list = buckets.get(c.type) ?? [];
      list.push(c);
      buckets.set(c.type, list);
    };
    const text = (type: NotificationType, v: Record<string, string>) => ({ title: fill(C.NOTIFICATION_TEXT[type].title, v).slice(0, 200), body: C.NOTIFICATION_TEXT[type].body ? fill(C.NOTIFICATION_TEXT[type].body!, v).slice(0, 1000) : null });
    for (const e of h.events.assigned) {
      if (e.userId !== u.id) continue;
      add({ at: e.at + 2 * SEC, type: 'lead_assigned', ...text('lead_assigned', { lead: e.leadName, company: e.company || 'No company', source: SOURCE_LABEL[e.source] ?? e.source }), path: `/leads?lead=${e.leadId}`, data: { leadId: e.leadId } });
    }
    for (const t of h.tasks) {
      if (t.assigneeId !== u.id) continue;
      const lead = t.leadId ? leadById.get(t.leadId) : undefined;
      const leadName = lead?.name ?? 'no lead';
      if (t.overdueNotifiedAt instanceof Date) {
        add({ at: t.overdueNotifiedAt.getTime(), type: 'task_overdue', title: `Task overdue: ${t.title}`.slice(0, 200), body: lead ? `For ${lead.name}` : null, path: `/tasks?task=${t.id}`, data: { taskId: t.id, leadId: t.leadId ?? null } });
      }
      if (t.remindAt instanceof Date && t.dueAt instanceof Date && t.remindAt.getTime() <= now) {
        add({ at: t.remindAt.getTime(), type: 'task_due', ...text('task_due', { task: t.title, time: time(t.dueAt.getTime()), lead: leadName }), path: `/tasks?task=${t.id}`, data: { taskId: t.id, leadId: t.leadId ?? null } });
      }
    }
    for (const e of h.events.inbound) {
      const mine = e.userId === u.id || (e.userId === null && u.kind === 'company_admin');
      if (!mine) continue;
      add({ at: e.at + SEC, type: 'message_received', ...text('message_received', { lead: e.leadName, preview: e.preview }), path: `/inbox?conversation=${e.conversationId}`, data: { conversationId: e.conversationId, leadId: e.leadId } });
    }
    if (u.kind === 'company_admin' || u.kind === 'manager') {
      const team = u.kind === 'manager' ? new Set(ctx.teams.filter((t) => t.managerId === u.id).flatMap((t) => t.memberIds)) : null;
      for (const f of h.events.failedRuns) {
        if (team && (!f.ownerId || !team.has(f.ownerId))) continue;
        add({ at: f.at + 5 * SEC, type: 'workflow_failed', ...text('workflow_failed', { workflow: f.workflowName, lead: f.leadName, error: f.error.slice(0, 120) }), path: `/workflows/${f.workflowId}?run=${f.runId}`, data: { workflowId: f.workflowId, runId: f.runId, leadId: f.leadId } });
      }
    }
    // Mentions come from a note on the lead (written to the timeline too).
    const mentionLeads = shuffle(rng, h.states.filter((s) => (u.kind === 'employee' || u.kind === 'manager' ? s.ownerId === u.id : true) && s.end > now - 25 * DAY)).slice(0, int(rng, 3, u.kind === 'viewer' ? 14 : 6));
    for (const s of mentionLeads) {
      const by = managerOf(u);
      const at = between(rng, Math.max(s.created + HOUR, now - 25 * DAY), now - 10 * MIN);
      if (at > now - 5 * MIN) continue;
      const note = pick(rng, C.MENTION_NOTES);
      h.activities.push({ id: randomUUID(), workspaceId, leadId: s.id, type: 'note', actorType: 'user', actorId: by.id, payload: { body: `@${firstName(u.name)} ${note}` }, createdAt: d(at) });
      if (at > s.lastAt) s.d.lead.lastActivityAt = d(at);
      add({ at: at + SEC, type: 'mention', ...text('mention', { actor: by.name, lead: s.name, note }), path: `/leads?lead=${s.id}`, data: { leadId: s.id, byUserId: by.id } });
    }
    const notices = C.SYSTEM_NOTICES[u.kind === 'company_admin' ? 'admin' : u.kind].filter(
      (n) => ctx.fx.slug !== 'sunrise' || !(n.title.startsWith('Support session') || n.title.startsWith('Outbound webhook')),
    );
    for (const [i, n] of notices.entries()) {
      add({ at: now - between(rng, (i + 1) * DAY, (i + 4) * DAY), type: 'system', title: n.title, body: n.body, path: n.href ?? '', data: {} });
    }
    if (u.kind === 'viewer' || u.kind === 'company_admin') {
      // Weekly summary every Monday morning.
      for (let w = 0; w < 6; w++) {
        let day = startOfDay(addDays(now, -7 * w));
        while (istWeekday(day + 12 * HOUR) !== 1) day = addDays(day, -1);
        add({ at: day + 9 * HOUR + between(rng, 0, 10 * MIN), type: 'system', title: 'Weekly sales summary', body: 'New leads, conversion and revenue for last week are ready.', path: '/reports', data: { week: iso(day) } });
      }
    }
    if (ctx.fx.status === 'trial' && u.kind === 'company_admin') {
      add({ at: now - between(rng, 2 * HOUR, 20 * HOUR), type: 'system', title: 'Your trial ends in 10 days', body: 'Choose a plan to keep WhatsApp, workflows and telephony running.', path: '/billing', data: { trialEndsAt: iso(now + 10 * DAY) } });
    }
    if (u.kind !== 'employee') {
      // Evening digest with the real numbers of that day (team scope for managers).
      const scope = u.kind === 'manager' ? new Set(ctx.teams.filter((t) => t.managerId === u.id).flatMap((t) => t.memberIds)) : null;
      for (let k = 1; k <= 24; k++) {
        const day = addDays(startOfDay(now), -k);
        if (istWeekday(day + 12 * HOUR) === 0) continue;
        const inDay = (t: number) => t >= day && t < day + DAY;
        const newLeads = h.states.filter((s) => inDay(s.created) && (!scope || (s.ownerId && scope.has(s.ownerId)))).length;
        const calls = h.calls.filter((c) => inDay((c.startedAt as Date).getTime()) && (!scope || (c.userId && scope.has(c.userId)))).length;
        const wonDay = h.states.filter((s) => s.finalIdx === 4 && s.closeAt !== null && inDay(s.closeAt) && (!scope || (s.ownerId && scope.has(s.ownerId))));
        const revenue = wonDay.reduce((a, s) => a + (s.d.lead.valueInr ?? 0), 0);
        add({
          at: day + 19.5 * HOUR + between(rng, 0, 5 * MIN), type: 'system', title: scope ? 'Team daily summary' : 'Daily summary',
          body: `${newLeads} new leads, ${calls} calls, ${wonDay.length} deals won (₹${revenue.toLocaleString('en-IN')})`, path: '/reports', data: { date: iso(day), newLeads, calls, dealsWon: wonDay.length, revenueInr: revenue },
        });
      }
    }

    const want = int(rng, 25, 40);
    for (const list of buckets.values()) list.sort((a, b) => b.at - a.at);
    const picked: Cand[] = [];
    while (picked.length < want && [...buckets.values()].some((l) => l.length)) {
      for (const list of buckets.values()) {
        const c = list.shift();
        if (c && picked.length < want) picked.push(c);
      }
    }
    for (const c of picked) {
      const recent = c.at > now - 36 * HOUR;
      const read = chance(rng, recent ? 0.35 : 0.9);
      x.notifications.push({
        id: randomUUID(), workspaceId, userId: u.id, type: c.type, title: c.title, body: c.body, href: c.path ? `${prefix}${c.path}` : null, data: c.data,
        readAt: read ? d(Math.min(now, c.at + between(rng, MIN, 8 * HOUR))) : null, createdAt: d(c.at),
      });
    }
  }

  // ------------------------------------------------------------ targets (previous and current month)
  const monthStart = (at: number) => {
    let t = startOfDay(at);
    while (monthKey(t - 12 * HOUR) === monthKey(at)) t = addDays(t, -1);
    return t;
  };
  const cur = monthKey(now);
  const curStart = monthStart(now);
  const prevStart = monthStart(curStart - DAY);
  const prev = monthKey(prevStart);
  const workingDays = (key: string) => {
    let n = 0;
    for (let t = key === cur ? curStart : prevStart; monthKey(t + 12 * HOUR) === key; t = addDays(t, 1)) if (istWeekday(t + 12 * HOUR) !== 0) n++;
    return n;
  };
  const won = new Map<string, { revenue: number; deals: number }>();
  for (const s of h.states) {
    if (s.finalIdx !== 4 || s.closeAt === null || !s.ownerId) continue;
    const k = `${s.ownerId}:${monthKey(s.closeAt)}`;
    const e = won.get(k) ?? { revenue: 0, deals: 0 };
    e.revenue += s.d.lead.valueInr ?? 0;
    e.deals += 1;
    won.set(k, e);
  }
  const callRate = ctx.fx.slug === 'shakti' ? { employee: 26, manager: 6 } : ctx.fx.slug === 'navkar' ? { employee: 13, manager: 5 } : { employee: 8, manager: 3 };
  const floor = ctx.fx.slug === 'shakti' ? 300_000 : ctx.fx.slug === 'navkar' ? 150_000 : 75_000;
  type Metric = 'revenue_inr' | 'deals_won' | 'calls' | 'leads_converted';
  const teamSums = new Map<string, number>();
  const setTarget = (subject: { userId?: string; teamId?: string }, metric: Metric, period: string, value: number) => {
    const subjectKey = subject.userId ? `user:${subject.userId}` : subject.teamId ? `team:${subject.teamId}` : 'workspace';
    const setAt = period === cur ? curStart - between(rng, 6 * HOUR, 2 * DAY) : addDays(curStart, -28) - between(rng, 3 * DAY, 5 * DAY);
    x.targets.push({ id: randomUUID(), workspaceId, userId: subject.userId ?? null, teamId: subject.teamId ?? null, subjectKey, metric, period, value, createdAt: d(Math.max(ctx.createdAt + DAY, setAt)), updatedAt: d(Math.max(ctx.createdAt + DAY, setAt)) });
  };
  for (const u of ctx.sales) {
    const p = won.get(`${u.id}:${prev}`) ?? { revenue: 0, deals: 0 };
    const rateU = (u.kind === 'manager' ? callRate.manager : callRate.employee) * (u.title === 'Field Sales' ? 0.4 : 1);
    for (const period of [prev, cur]) {
      const grow = period === cur ? 1 + rng() * 0.2 : 0.85 + rng() * 0.4;
      const values: Record<Metric, number> = {
        revenue_inr: roundTo(Math.max(floor * (u.kind === 'manager' ? 0.6 : 1), p.revenue * grow), 10_000),
        deals_won: Math.max(1, Math.round(p.deals * grow)),
        calls: roundTo(workingDays(period) * rateU * (0.9 + rng() * 0.15), 10),
        leads_converted: 0,
      };
      values.leads_converted = values.deals_won;
      for (const m of Object.keys(values) as Metric[]) {
        setTarget({ userId: u.id }, m, period, values[m]);
        if (u.teamId) teamSums.set(`${u.teamId}|${m}|${period}`, (teamSums.get(`${u.teamId}|${m}|${period}`) ?? 0) + values[m]);
        teamSums.set(`ws|${m}|${period}`, (teamSums.get(`ws|${m}|${period}`) ?? 0) + values[m]);
      }
    }
  }
  for (const [key, value] of teamSums) {
    const [team, metric, period] = key.split('|') as [string, Metric, string];
    if (team === 'ws') {
      if (metric === 'revenue_inr' || metric === 'deals_won') setTarget({}, metric, period, value);
    } else setTarget({ teamId: team }, metric, period, value);
  }

  // ------------------------------------------------------------ saved views (2-4 per admin and manager)
  const cols = ['lead', 'phone', 'source', 'stage', 'owner', 'value', 'score', 'followUp'];
  const view = (owner: SeedUser, name: string, filters: Record<string, unknown>, viewMode: 'board' | 'table' | null, isShared: boolean, columns = cols) =>
    x.savedViews.push({ id: randomUUID(), workspaceId, ownerId: owner.id, name, entity: 'lead', filters: { ...filters, viewMode } as Json, columns, viewMode, isShared, createdAt: d(ctx.createdAt + between(rng, 5 * DAY, 60 * DAY)) });
  view(ctx.admin, 'Hot IndiaMART enquiries', { source: ['indiamart'], temperature: ['hot'], sort: 'createdAt', dir: 'desc' }, 'board', true);
  view(ctx.admin, 'Unassigned leads', { ownerId: ['unassigned'] }, 'table', true, ['lead', 'phone', 'source', 'stage', 'value', 'created']);
  view(ctx.admin, 'Quotes to chase', { stageId: [stageId('quote_sent')], scoreMin: 50, sort: 'valueInr', dir: 'desc' }, 'table', false);
  if (ctx.fx.slug === 'shakti') view(ctx.admin, 'Export buyers', { tag: ['export'] }, null, false);
  for (const [i, m] of ctx.managers.entries()) {
    view(m, 'My team: new this week', { stageId: [stageId('new')], createdFrom: iso(startOfDay(now) - 7 * DAY) }, 'board', false);
    view(m, 'WhatsApp leads', { source: ['whatsapp'], sort: 'lastActivityAt', dir: 'desc' }, 'table', false, ['lead', 'phone', 'stage', 'owner', 'temperature', 'tags']);
    if (i === 0) view(m, 'Warm and hot follow-ups', { tag: ['follow-up'], temperature: ['hot', 'warm'] }, null, true);
  }

  // ------------------------------------------------------------ tags and quick replies
  const used = new Set(h.states.flatMap((s) => [...s.tags]));
  for (const name of [...used].sort()) x.tags.push({ id: randomUUID(), workspaceId, name, color: C.TAG_COLORS[name] ?? null, createdAt: d(ctx.createdAt + DAY) });
  const qrCount = ctx.fx.slug === 'shakti' ? C.QUICK_REPLIES.length : ctx.fx.slug === 'navkar' ? 8 : 6;
  for (const q of C.QUICK_REPLIES.slice(0, qrCount)) x.quickReplies.push({ id: randomUUID(), workspaceId, shortcut: q.shortcut, body: q.body, createdAt: d(ctx.createdAt + 3 * DAY) });

  // ------------------------------------------------------------ integrations
  const connectedAt = ctx.createdAt + between(rng, DAY, 3 * DAY);
  const imported30d = h.states.filter((s) => s.d.source === 'indiamart' && s.created > now - 30 * DAY).length;
  const integ = (provider: Prisma.IntegrationCreateManyInput['provider'], displayName: string, config: Json, secrets: Record<string, string> | null, status: 'connected' | 'error' = 'connected', lastError: string | null = null) =>
    x.integrations.push({
      id: randomUUID(), workspaceId, provider, status, displayName, config, secretsEncrypted: secrets ? encryptSecret(JSON.stringify(secrets)) : null,
      lastCheckedAt: d(now - between(rng, MIN, 40 * MIN)), lastError, connectedAt: d(connectedAt + between(rng, 0, 2 * DAY)), createdAt: d(connectedAt), updatedAt: d(now - between(rng, MIN, 40 * MIN)),
    });
  integ('indiamart', 'IndiaMART Lead Manager', { mode: 'pull', pullIntervalMin: 15, glusrId: String(int(rng, 10_000_000, 99_999_999)), lastPulledAt: iso(now - between(rng, MIN, 14 * MIN)), enquiriesLast30Days: imported30d }, { crmKey: randomToken(24) });
  integ('whatsapp_cloud', 'WhatsApp Cloud API', { phoneNumberId: ctx.business.phoneNumberId, wabaId: ctx.business.wabaId, displayPhoneNumber: ctx.business.number, verifiedName: ctx.workspaceName, qualityRating: 'GREEN', messagingLimit: ctx.fx.slug === 'shakti' ? 'TIER_10K' : 'TIER_1K' }, { accessToken: randomToken(48), appSecret: randomToken(24) });
  integ('telephony', 'Telephony (mock adapter)', { provider: 'mock', callerId: ctx.business.number, recordCalls: true, ringTimeoutSec: 30 }, null);
  if (ctx.fx.slug === 'shakti') {
    integ('smtp', 'Email (SMTP)', { host: 'smtp.zoho.in', port: 587, secure: false, from: 'sales@shakti.example' }, { password: randomToken(18) }, 'error', 'Authentication failed (535): check the app password');
  }

  // ------------------------------------------------------------ webhooks
  const endpoint = (e: Omit<Prisma.WebhookEndpointCreateManyInput, 'id' | 'workspaceId' | 'secretEncrypted' | 'secretLast4'>) => {
    const secret = `whsec_${randomToken(24)}`;
    const id = randomUUID();
    x.endpoints.push({ id, workspaceId, secretEncrypted: encryptSecret(secret), secretLast4: secret.slice(-4), ...e });
    return id;
  };
  const inboundId = endpoint({
    direction: 'inbound', name: 'Website contact form', isActive: true, sourceKey: 'website-form', action: 'create_lead',
    mapping: { fields: [{ from: 'name', to: 'name', transform: 'trim' }, { from: 'mobile', to: 'phone', transform: 'phone_in' }, { from: 'email', to: 'email', transform: 'lower' }, { from: 'city', to: 'city', transform: 'trim' }, { from: 'product', to: 'productInterest', transform: 'trim' }, { from: 'message', to: 'requirement', transform: 'none' }], defaults: { source: 'webhook' } },
    createdAt: d(ctx.createdAt + 2 * DAY), updatedAt: d(ctx.createdAt + 2 * DAY),
  });
  const reqHeaders = (extra: Record<string, string>) => ({ 'content-type': 'application/json', ...extra, 'x-vistar-signature': '[redacted]' });
  for (const s of h.states.filter((st) => st.d.source === 'webhook')) {
    const key = `wp-${randomUUID().slice(0, 13)}`;
    const at = s.created - SEC;
    x.deliveries.push({
      id: randomUUID(), workspaceId, endpointId: inboundId, direction: 'inbound', event: 'lead.create', eventId: null, status: 'success', attempt: 1,
      requestHeaders: reqHeaders({ 'user-agent': 'WordPress/6.6; https://example.in', 'idempotency-key': key }),
      requestBody: { name: s.name, mobile: s.phone, email: s.d.lead.email ?? null, city: s.city, product: s.product, message: s.d.lead.requirement ?? null },
      responseStatus: 202, responseBody: JSON.stringify({ ok: true, duplicate: false, leadId: s.id, runId: null }), latencyMs: int(rng, 35, 180), idempotencyKey: key, createdAt: d(at), updatedAt: d(at + 200),
    });
    if (chance(rng, 0.08)) {
      // The form plugin retried with the same key: accepted as a duplicate, nothing re-processed.
      x.deliveries.push({
        id: randomUUID(), workspaceId, endpointId: inboundId, direction: 'inbound', event: 'lead.create', eventId: null, status: 'success', attempt: 1,
        requestHeaders: reqHeaders({ 'user-agent': 'WordPress/6.6; https://example.in', 'idempotency-key': key }), requestBody: { name: s.name, mobile: s.phone, city: s.city, product: s.product },
        responseStatus: 200, responseBody: JSON.stringify({ ok: true, duplicate: true, leadId: s.id, runId: null }), latencyMs: int(rng, 12, 40), idempotencyKey: key, createdAt: d(at + 30 * SEC), updatedAt: d(at + 30 * SEC),
      });
    }
  }
  for (let i = 0; i < 3; i++) {
    const at = now - between(rng, 2 * DAY, 20 * DAY);
    x.deliveries.push({
      id: randomUUID(), workspaceId, endpointId: inboundId, direction: 'inbound', event: 'lead.create', eventId: null, status: 'failed', attempt: 1,
      requestHeaders: reqHeaders({ 'user-agent': 'python-requests/2.32' }), requestBody: { name: 'test', mobile: '+910000000000' }, responseStatus: 401,
      responseBody: JSON.stringify({ error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Invalid signature' } }), latencyMs: int(rng, 3, 12), error: C.WEBHOOK_ERRORS.signature, createdAt: d(at), updatedAt: d(at),
    });
  }
  if (ctx.fx.slug !== 'sunrise') {
    const shakti = ctx.fx.slug === 'shakti';
    const events: OutboundWebhookEvent[] = shakti ? ['lead.created', 'lead.assigned', 'stage.changed'] : ['stage.changed'];
    const outId = endpoint({
      direction: 'outbound', name: shakti ? 'ERP sync' : 'Tally bridge', isActive: true, url: shakti ? 'https://erp.shakti.example/hooks/vistar' : 'https://tally-bridge.navkar.example/vistar', events,
      createdAt: d(ctx.createdAt + 20 * DAY), updatedAt: d(ctx.createdAt + 20 * DAY),
    });
    const outEvents: Array<{ at: number; event: OutboundWebhookEvent; payload: Json }> = [];
    for (const a of h.activities) {
      const at = (a.createdAt as Date).getTime();
      if (at < now - 4 * DAY) continue;
      const p = a.payload as Record<string, unknown>;
      if (a.type === 'stage_changed' && events.includes('stage.changed')) outEvents.push({ at, event: 'stage.changed', payload: { leadId: a.leadId, fromStageId: p.fromStageId ?? null, toStageId: p.toStageId ?? null } });
      else if (a.type === 'lead_created' && events.includes('lead.created')) outEvents.push({ at, event: 'lead.created', payload: { lead: { id: a.leadId, name: leadById.get(a.leadId)?.name ?? null, source: p.source ?? null } } });
      else if (a.type === 'assigned' && events.includes('lead.assigned')) outEvents.push({ at, event: 'lead.assigned', payload: { leadId: a.leadId, fromUserId: p.fromUserId ?? null, toUserId: p.toUserId ?? null } });
    }
    outEvents.sort((a, b) => a.at - b.at);
    // ERP is timing out right now (recent deliveries are retrying); a few payloads were rejected for good (dead-letter).
    const outageFrom = now - between(rng, 25 * MIN, 50 * MIN);
    const deadIds: string[] = [];
    const total = (n: number) => WEBHOOK_RETRY_DELAYS_SEC.slice(0, n).reduce((a, b) => a + b, 0) * SEC;
    for (const e of outEvents) {
      const id = randomUUID();
      const eventId = randomUUID();
      const base = {
        id, workspaceId, endpointId: outId, direction: 'outbound' as const, event: e.event, eventId, idempotencyKey: eventId,
        requestHeaders: reqHeaders({ 'user-agent': 'Vistar-Webhooks/1.0', 'x-vistar-event': e.event, 'x-vistar-delivery': id, 'x-vistar-timestamp': String(Math.floor(e.at / 1000)) }),
        requestBody: { id: eventId, type: e.event, workspaceId, occurredAt: iso(e.at), payload: e.payload }, createdAt: d(e.at),
      };
      if (e.at >= outageFrom) {
        const attempt = 1 + WEBHOOK_RETRY_DELAYS_SEC.findIndex((_, i) => e.at + total(i + 1) > now);
        const tries = Math.max(1, attempt);
        x.deliveries.push({ ...base, status: 'failed', attempt: tries, responseStatus: null, responseBody: null, latencyMs: 10_000, error: C.WEBHOOK_ERRORS.timeout, nextAttemptAt: d(e.at + total(tries)), updatedAt: d(e.at + total(tries - 1)) });
      } else if (e.at < now - 34 * HOUR && chance(rng, 0.03)) {
        const last = e.at + total(WEBHOOK_RETRY_DELAYS_SEC.length);
        x.deliveries.push({ ...base, status: 'dead', attempt: WEBHOOK_RETRY_DELAYS_SEC.length + 1, responseStatus: 422, responseBody: JSON.stringify({ error: 'customer code missing for this lead' }), latencyMs: int(rng, 90, 400), error: 'Endpoint returned HTTP 422', updatedAt: d(last) });
        deadIds.push(id);
      } else if (chance(rng, 0.06)) {
        x.deliveries.push({ ...base, status: 'success', attempt: 2, responseStatus: 200, responseBody: '{"status":"ok"}', latencyMs: int(rng, 150, 900), updatedAt: d(e.at + total(1)) });
      } else {
        x.deliveries.push({ ...base, status: 'success', attempt: 1, responseStatus: 200, responseBody: '{"status":"ok"}', latencyMs: int(rng, 80, 600), updatedAt: d(e.at + int(rng, 100, 700)) });
      }
    }
    // An admin fixed the ERP mapping and replayed two dead deliveries.
    for (const deadId of deadIds.slice(0, 2)) {
      const dead = x.deliveries.find((r) => r.id === deadId)!;
      const at = (dead.updatedAt as Date).getTime() + between(rng, 20 * MIN, 3 * HOUR);
      if (at > now) continue;
      const id = randomUUID();
      x.deliveries.push({ ...dead, id, status: 'success', attempt: 1, responseStatus: 200, responseBody: '{"status":"ok"}', error: null, latencyMs: int(rng, 90, 500), replayOfId: deadId, requestHeaders: { ...(dead.requestHeaders as Record<string, string>), 'x-vistar-delivery': id }, createdAt: d(at), updatedAt: d(at + 400) });
    }
  }

  // ------------------------------------------------------------ API keys (plans with api_access only)
  const keySpecs: Array<{ name: string; scopes: ApiKeyScope[]; createdAgo: number; usedAgo: number | null; revokedAgo?: number; expiresIn?: number }> =
    ctx.fx.plan === 'growth' || ctx.fx.plan === 'enterprise'
      ? [
          { name: 'ERP sync', scopes: ['leads.read', 'leads.update', 'tasks.read'], createdAgo: 40 * DAY, usedAgo: 3 * MIN },
          { name: 'Website form backup', scopes: ['leads.create'], createdAgo: 70 * DAY, usedAgo: 2 * DAY },
          { name: 'Old Zapier key', scopes: ['leads.read', 'leads.create'], createdAgo: 95 * DAY, usedAgo: 26 * DAY, revokedAgo: 21 * DAY },
        ]
      : ctx.fx.plan === 'starter'
        ? [{ name: 'Tally connector', scopes: ['leads.read'], createdAgo: 30 * DAY, usedAgo: 6 * HOUR, expiresIn: 180 * DAY }]
        : [];
  for (const k of keySpecs) {
    const key = `${API_KEY_PREFIX}${randomToken(24)}`;
    const id = randomUUID();
    const createdAt = now - k.createdAgo;
    x.apiKeys.push({
      id, workspaceId, name: k.name, prefix: key.slice(0, API_KEY_PREFIX.length + 4), keyHash: hashToken(key), scopes: k.scopes, lastUsedAt: k.usedAgo !== null ? d(now - k.usedAgo) : null,
      expiresAt: k.expiresIn ? d(now + k.expiresIn) : null, revokedAt: k.revokedAgo ? d(now - k.revokedAgo) : null, createdById: ctx.admin.id, createdAt: d(createdAt),
    });
    audit(ctx.admin, createdAt, 'apikey.create', 'api_key', id, { name: k.name, prefix: key.slice(0, API_KEY_PREFIX.length + 4), scopes: k.scopes });
    if (k.revokedAgo) audit(ctx.admin, now - k.revokedAgo, 'apikey.revoke', 'api_key', id, { name: k.name });
  }

  // ------------------------------------------------------------ usage counters (current month)
  const monthStartMs = curStart;
  const recorded = h.calls.filter((c) => c.recordingKey).length;
  const usage: Record<string, number> = {
    seats: ctx.users.length,
    leads: h.states.length,
    whatsapp_messages: h.messages.filter((m) => m.direction === 'outbound' && !m.isInternalNote && (m.createdAt as Date).getTime() >= monthStartMs).length,
    workflow_runs: h.runs.filter((r) => !r.isTest && (r.startedAt as Date).getTime() >= monthStartMs).length,
    storage_mb: Math.round(recorded * 0.45 + 12),
    // change #19 wave C: billing
    api_keys: x.apiKeys.filter((k) => k.workspaceId === workspaceId && !k.revokedAt && (!k.expiresAt || (k.expiresAt as Date).getTime() > now)).length,
    api_calls: x.apiKeys.some((k) => k.workspaceId === workspaceId) ? 400 + Math.round(h.states.length * 0.6) : 0,
  };
  for (const [metric, value] of Object.entries(usage)) x.usage.push({ id: randomUUID(), workspaceId, period: cur, metric, value, updatedAt: d(now - between(rng, MIN, 20 * MIN)) });

  // ------------------------------------------------------------ settings and invites
  x.settings.push({ id: randomUUID(), workspaceId, scope: 'workspace', scopeId: workspaceId, key: SETTING_KEYS.workspace.showEmployeeRank, value: ctx.fx.slug !== 'sunrise', createdAt: d(ctx.createdAt + DAY), updatedAt: d(ctx.createdAt + 9 * DAY) });
  x.settings.push({ id: randomUUID(), workspaceId, scope: 'workspace', scopeId: workspaceId, key: SETTING_KEYS.workspace.defaultLeadsViewMode, value: 'board', createdAt: d(ctx.createdAt + DAY), updatedAt: d(ctx.createdAt + DAY) });
  for (const u of ctx.users) {
    if (u.kind === 'company_admin') continue;
    const created = Math.max(ctx.createdAt + MIN, u.joinedAt - between(rng, 5 * MIN, 15 * MIN));
    const id = randomUUID();
    x.invites.push({ id, workspaceId, email: u.email, roleId: ctx.roleIds.get(u.kind)!, teamId: u.teamId, tokenHash: hashToken(randomToken()), expiresAt: d(created + 7 * DAY), acceptedAt: d(u.joinedAt), createdById: ctx.admin.id, createdAt: d(created) });
    audit(ctx.admin, created, 'invite.create', 'invite', id, { email: maskEmail(u.email), roleId: ctx.roleIds.get(u.kind)!, teamId: u.teamId });
    audit(u, u.joinedAt, 'invite.accept', 'invite', id, { email: maskEmail(u.email) });
  }
  const domain = ctx.admin.email.split('@')[1]!;
  const pending: Array<{ local: string; kind: 'employee' | 'viewer'; ago: number; revoked?: boolean }> =
    ctx.fx.slug === 'shakti' ? [{ local: 'nikhil.rao', kind: 'employee', ago: 2 * DAY }, { local: 'accounts2', kind: 'viewer', ago: 5 * HOUR }, { local: 'tarun.old', kind: 'employee', ago: 40 * DAY, revoked: true }] : ctx.fx.slug === 'navkar' ? [{ local: 'pankaj', kind: 'employee', ago: DAY }] : [];
  for (const p of pending) {
    const id = randomUUID();
    const created = now - p.ago;
    const team = p.kind === 'employee' ? ctx.teams[0]?.id ?? null : null;
    x.invites.push({ id, workspaceId, email: `${p.local}@${domain}`, roleId: ctx.roleIds.get(p.kind)!, teamId: team, tokenHash: hashToken(randomToken()), expiresAt: d(created + 7 * DAY), revokedAt: p.revoked ? d(created + 3 * DAY) : null, createdById: ctx.admin.id, createdAt: d(created) });
    audit(ctx.admin, created, 'invite.create', 'invite', id, { email: maskEmail(`${p.local}@${domain}`), roleId: ctx.roleIds.get(p.kind)!, teamId: team });
    if (p.revoked) audit(ctx.admin, created + 3 * DAY, 'invite.revoke', 'invite', id, null);
  }

  // ------------------------------------------------------------ audit log (company side)
  function audit(actor: SeedUser, at: number, action: string, entityType: string, entityId: string | null, diff: Record<string, unknown> | null) {
    x.audit.push({ id: randomUUID(), workspaceId, actorType: 'user', actorId: actor.id, actorName: actor.name, action, entityType, entityId, diff: diff ? (diff as Json) : undefined, ip: pick(rng, C.AUDIT_IPS), userAgent: pick(rng, C.USER_AGENTS), createdAt: d(Math.min(now, at)) });
  }
  const base = ctx.createdAt;
  audit(ctx.admin, base, 'workspace.create', 'workspace', workspaceId, { name: ctx.workspaceName, plan: ctx.fx.slug === 'sunrise' ? 'free' : ctx.fx.slug === 'navkar' ? 'free' : 'starter' });
  for (const t of ctx.teams) audit(ctx.admin, base + 30 * MIN, 'team.create', 'team', t.id, { name: t.name, managerId: t.managerId });
  for (const w of ctx.workflows.filter((wf) => wf.active)) {
    const by = ctx.managers[0] ?? ctx.admin;
    audit(by, base + 3 * DAY, 'workflow.publish', 'workflow', w.id, { name: w.name, version: 1 });
    audit(by, base + 3 * DAY + 5 * MIN, 'workflow.status', 'workflow', w.id, { status: { from: 'draft', to: 'active' } });
  }
  for (const i of x.integrations) audit(ctx.admin, (i.createdAt as Date).getTime(), 'integration.connect', 'integration', i.id ?? null, { provider: i.provider, displayName: i.displayName });
  for (const e of x.endpoints) audit(ctx.admin, (e.createdAt as Date).getTime(), 'webhook.create', 'webhook_endpoint', e.id ?? null, { name: e.name, direction: e.direction, events: e.events ?? [] });
  const promoted = ctx.managers[ctx.managers.length - 1];
  if (promoted) audit(ctx.admin, base + 18 * DAY, 'user.role_change', 'user', promoted.id, { role: { from: 'Employee', to: 'Manager' } });
  if (ctx.fx.slug === 'shakti') {
    const moved = ctx.users.find((u) => u.key === 'rep6');
    const from = ctx.teams.find((t) => t.name === 'Inside Sales');
    const to = ctx.teams.find((t) => t.name === 'Key Accounts');
    if (moved && from && to) audit(ctx.admin, base + 25 * DAY, 'user.team_change', 'user', moved.id, { teamId: { from: from.id, to: to.id } });
    const empRole = ctx.roleIds.get('employee')!;
    audit(ctx.admin, base + 40 * DAY, 'role.update', 'role', empRole, { permissions: { added: ['leads.export'], removed: [] } });
    audit(ctx.admin, base + 47 * DAY, 'role.update', 'role', empRole, { permissions: { added: [], removed: ['leads.export'] } });
  }
  audit(ctx.admin, now - 20 * DAY, 'workspace.update', 'workspace', workspaceId, { holidays: { added: ['2026-11-08 Diwali'] } });
  audit(ctx.admin, base + 2 * DAY, 'workspace.theme', 'workspace', workspaceId, { defaultTheme: { from: 'light', to: 'system' } });
  if (ctx.fx.slug === 'sunrise') audit(ctx.admin, base + 9 * DAY, 'workspace.update', 'workspace', workspaceId, { showEmployeeRank: { from: true, to: false } });
  const exporters = [ctx.admin, ...ctx.managers];
  const exportCount = ctx.fx.slug === 'shakti' ? 12 : ctx.fx.slug === 'navkar' ? 5 : 2;
  for (let i = 0; i < exportCount; i++) {
    const by = pick(rng, exporters);
    const filters = pick(rng, [{ source: ['indiamart'] }, { stageId: [stageId('won')] }, {}, { temperature: ['hot'] }, { tag: ['export'] }]);
    audit(by, now - between(rng, 2 * HOUR, 75 * DAY), 'lead.export', 'lead', null, { format: chance(rng, 0.7) ? 'csv' : 'xlsx', rows: int(rng, 40, Math.max(60, Math.round(h.states.length * 0.6))), filters });
  }
  return x;
}
