/**
 * Who may receive a domain event (pure). The realtime gateway applies the same data scope as REST:
 * an employee only gets lead, task, call, conversation, record and presence payloads the REST API
 * would show them (CONTRACTS section 7). Every event name has an explicit rule (typed Record), so a
 * new event cannot reach sockets until it is classified here.
 */
import type { DomainEvent, EventName, Permission } from '@vistar/shared';

/** What a socket is allowed to see (resolved at connect, refreshed every minute). */
export interface SocketViewer {
  userId: string;
  workspaceId: string;
  /** null = every user in the workspace (scope all). */
  visibleUserIds: ReadonlySet<string> | null;
  permissions: ReadonlySet<string>;
}

export type Audience =
  /** Everyone signed in to the workspace. */
  | { kind: 'workspace' }
  /** Visible when any owner is in the viewer's scope; a null owner is visible to scope all (or with `nullOwnerPermission`). */
  | { kind: 'owners'; ownerIds: ReadonlyArray<string | null>; nullOwnerPermission?: Permission; permission?: Permission; allowSelf?: boolean }
  /** Owner of a lead must be looked up first (the payload only has the lead id). */
  | { kind: 'lead'; leadId: string; fallbackOwnerIds: ReadonlyArray<string | null> }
  /** Anyone with this permission (workflow runs, webhook deliveries). */
  | { kind: 'permission'; permission: Permission }
  /** Workspace-wide aggregates: scope all only. */
  | { kind: 'scope_all' };

type Rule = (event: DomainEvent) => Audience;
const ev = <E extends EventName>(fn: (e: DomainEvent<E>) => Audience): Rule => fn as Rule;

export const AUDIENCE_RULES: Record<EventName, Rule> = {
  'lead.created': ev<'lead.created'>((e) => ({ kind: 'owners', ownerIds: [e.payload.lead.owner?.id ?? null], permission: 'leads.read' })),
  'lead.updated': ev<'lead.updated'>((e) => ({ kind: 'owners', ownerIds: [e.payload.lead.owner?.id ?? null], permission: 'leads.read' })),
  'lead.assigned': ev<'lead.assigned'>((e) => ({ kind: 'owners', ownerIds: [e.payload.toUserId], permission: 'leads.read' })),
  'stage.changed': ev<'stage.changed'>((e) => ({ kind: 'owners', ownerIds: [e.payload.lead.owner?.id ?? null], permission: 'leads.read' })),
  // ids only: nothing to leak, and clients must drop the cards
  'lead.deleted': () => ({ kind: 'workspace' }),
  'lead.merged': () => ({ kind: 'workspace' }),
  'activity.created': ev<'activity.created'>((e) => ({ kind: 'lead', leadId: e.payload.activity.leadId, fallbackOwnerIds: [] })),
  'feed.item': ev<'feed.item'>((e) =>
    e.payload.item.leadId ? { kind: 'lead', leadId: e.payload.item.leadId, fallbackOwnerIds: [e.payload.item.actor?.id ?? null] } : { kind: 'owners', ownerIds: [e.payload.item.actor?.id ?? null] },
  ),
  'task.created': ev<'task.created'>((e) => ({ kind: 'owners', ownerIds: [e.payload.task.assignee?.id ?? null], permission: 'tasks.read' })),
  'task.updated': ev<'task.updated'>((e) => ({ kind: 'owners', ownerIds: [e.payload.task.assignee?.id ?? null], permission: 'tasks.read' })),
  'task.overdue': ev<'task.overdue'>((e) => ({ kind: 'owners', ownerIds: [e.payload.task.assignee?.id ?? null], permission: 'tasks.read' })),
  'call.started': ev<'call.started'>((e) => ({ kind: 'owners', ownerIds: [e.payload.call.user?.id ?? null], permission: 'calls.read' })),
  'call.ended': ev<'call.ended'>((e) => ({ kind: 'owners', ownerIds: [e.payload.call.user?.id ?? null], permission: 'calls.read' })),
  'call.updated': ev<'call.updated'>((e) => ({ kind: 'owners', ownerIds: [e.payload.call.user?.id ?? null], permission: 'calls.read' })),
  'employee.status_changed': ev<'employee.status_changed'>((e) => ({ kind: 'owners', ownerIds: [e.payload.userId] })),
  // where in the office: the same people who see the person's status
  'employee.zone_changed': ev<'employee.zone_changed'>((e) => ({ kind: 'owners', ownerIds: [e.payload.userId] })),
  // attendance and GPS: the person, and managers and admins whose scope includes them (team.read)
  'attendance.checked_in': ev<'attendance.checked_in'>((e) => ({ kind: 'owners', ownerIds: [e.payload.session.userId], permission: 'team.read', allowSelf: true })),
  'attendance.checked_out': ev<'attendance.checked_out'>((e) => ({ kind: 'owners', ownerIds: [e.payload.session.userId], permission: 'team.read', allowSelf: true })),
  'location.updated': ev<'location.updated'>((e) => ({ kind: 'owners', ownerIds: [e.payload.userId], permission: 'team.read', allowSelf: true })),
  'workspace.branding_changed': () => ({ kind: 'workspace' }),
  'floor_request.updated': () => ({ kind: 'permission', permission: 'settings.manage' }),
  'floor.published': () => ({ kind: 'workspace' }),
  'message.received': ev<'message.received'>((e) => conversationAudience(e.payload.conversation.assignee?.id ?? null)),
  'message.sent': ev<'message.sent'>((e) => conversationAudience(e.payload.conversation.assignee?.id ?? null)),
  // ids and a status only; the client patches a conversation it already holds
  'message.status_updated': () => ({ kind: 'permission', permission: 'messages.read' }),
  'conversation.updated': ev<'conversation.updated'>((e) => conversationAudience(e.payload.conversation.assignee?.id ?? null)),
  'notification.created': () => ({ kind: 'workspace' }), // always addressed to one user room (envelope userId)
  'attention.raised': ev<'attention.raised'>((e) =>
    e.payload.item.leadId ? { kind: 'lead', leadId: e.payload.item.leadId, fallbackOwnerIds: [e.payload.item.userId] } : { kind: 'owners', ownerIds: [e.payload.item.userId] },
  ),
  'attention.resolved': () => ({ kind: 'workspace' }),
  'dashboard.kpis_updated': () => ({ kind: 'scope_all' }),
  'workflow.run_updated': () => ({ kind: 'permission', permission: 'workflows.read' }),
  'workflow.step_updated': () => ({ kind: 'permission', permission: 'workflows.read' }),
  'workflow.failed': () => ({ kind: 'permission', permission: 'workflows.read' }),
  'webhook.delivery_updated': () => ({ kind: 'permission', permission: 'webhooks.read' }),
  // ---- change #19 wave C: hub
  'integration.updated': () => ({ kind: 'permission', permission: 'integrations.read' }),
  'webhook.endpoint_updated': () => ({ kind: 'permission', permission: 'webhooks.read' }),
  // ---- end change #19 wave C: hub
  'import.progress': () => ({ kind: 'permission', permission: 'leads.import' }),
  'theme.changed': () => ({ kind: 'workspace' }),
  'customization.changed': () => ({ kind: 'workspace' }),
  'pack.installed': () => ({ kind: 'workspace' }),
  'pack.uninstalled': () => ({ kind: 'workspace' }),
  'record.created': ev<'record.created'>((e) => ({ kind: 'owners', ownerIds: [e.payload.record.ownerId], permission: 'records.read' })),
  'record.updated': ev<'record.updated'>((e) => ({ kind: 'owners', ownerIds: [e.payload.record.ownerId], permission: 'records.read' })),
  'record.deleted': () => ({ kind: 'permission', permission: 'records.read' }),
  // change #19 wave B: CRM. Owner-scoped like leads; ids-only deletes go to everyone with the read permission.
  'contact.created': ev<'contact.created'>((e) => ({ kind: 'owners', ownerIds: [e.payload.contact.owner?.id ?? null], permission: 'contacts.read' })),
  'contact.updated': ev<'contact.updated'>((e) => ({ kind: 'owners', ownerIds: [e.payload.contact.owner?.id ?? null], permission: 'contacts.read' })),
  'contact.deleted': () => ({ kind: 'permission', permission: 'contacts.read' }),
  'contact.merged': () => ({ kind: 'permission', permission: 'contacts.read' }),
  'account.created': ev<'account.created'>((e) => ({ kind: 'owners', ownerIds: [e.payload.account.owner?.id ?? null], permission: 'accounts.read' })),
  'account.updated': ev<'account.updated'>((e) => ({ kind: 'owners', ownerIds: [e.payload.account.owner?.id ?? null], permission: 'accounts.read' })),
  'account.deleted': () => ({ kind: 'permission', permission: 'accounts.read' }),
  'account.merged': () => ({ kind: 'permission', permission: 'accounts.read' }),
  'deal.created': ev<'deal.created'>((e) => ({ kind: 'owners', ownerIds: [e.payload.deal.owner?.id ?? null], permission: 'deals.read' })),
  'deal.updated': ev<'deal.updated'>((e) => ({ kind: 'owners', ownerIds: [e.payload.deal.owner?.id ?? null], permission: 'deals.read' })),
  'deal.moved': ev<'deal.moved'>((e) => ({ kind: 'owners', ownerIds: [e.payload.deal.owner?.id ?? null], permission: 'deals.read' })),
  'deal.deleted': () => ({ kind: 'permission', permission: 'deals.read' }),
  'quotation.created': ev<'quotation.created'>((e) => ({ kind: 'owners', ownerIds: [e.payload.quotation.owner?.id ?? null], permission: 'quotations.read' })),
  'quotation.updated': ev<'quotation.updated'>((e) => ({ kind: 'owners', ownerIds: [e.payload.quotation.owner?.id ?? null], permission: 'quotations.read' })),
  'quotation.deleted': () => ({ kind: 'permission', permission: 'quotations.read' }),
  'invoice.created': ev<'invoice.created'>((e) => ({ kind: 'owners', ownerIds: [e.payload.invoice.owner?.id ?? null], permission: 'invoices.read' })),
  'invoice.updated': ev<'invoice.updated'>((e) => ({ kind: 'owners', ownerIds: [e.payload.invoice.owner?.id ?? null], permission: 'invoices.read' })),
  'invoice.deleted': () => ({ kind: 'permission', permission: 'invoices.read' }),
  'invoice.payment_recorded': ev<'invoice.payment_recorded'>((e) => ({ kind: 'owners', ownerIds: [e.payload.invoice.owner?.id ?? null], permission: 'invoices.read' })),
  'catalog.changed': () => ({ kind: 'permission', permission: 'products.read' }),
  'meeting.created': ev<'meeting.created'>((e) => meetingAudience(e.payload.meeting.organizer?.id ?? null, e.payload.meeting.attendees.map((a) => a.userId))),
  'meeting.updated': ev<'meeting.updated'>((e) => meetingAudience(e.payload.meeting.organizer?.id ?? null, e.payload.meeting.attendees.map((a) => a.userId))),
  'meeting.deleted': ev<'meeting.deleted'>((e) => meetingAudience(e.payload.organizerId, e.payload.attendeeUserIds)),
  'meeting.reminder': () => ({ kind: 'workspace' }), // always addressed to one user room (envelope userId)
  // ---- change #19 wave C: billing (company admins by default)
  'billing.subscription_updated': () => ({ kind: 'permission', permission: 'billing.read' }),
  'billing.invoice_updated': () => ({ kind: 'permission', permission: 'billing.read' }),
  'billing.usage_alert': () => ({ kind: 'permission', permission: 'billing.read' }),
  // ---- change #20: config
  'whatsapp_template.updated': () => ({ kind: 'permission', permission: 'templates.read' }),
  'whatsapp_template.deleted': () => ({ kind: 'permission', permission: 'templates.read' }),
  'email_template.updated': () => ({ kind: 'permission', permission: 'templates.read' }),
};

/** Organizer and attending users; attendees always get their own meetings. */
function meetingAudience(organizerId: string | null, attendeeUserIds: ReadonlyArray<string | null>): Audience {
  return { kind: 'owners', ownerIds: [organizerId, ...attendeeUserIds.filter((id): id is string => !!id)], permission: 'calendar.read', allowSelf: true };
}

function conversationAudience(assigneeId: string | null): Audience {
  return { kind: 'owners', ownerIds: [assigneeId], nullOwnerPermission: 'messages.team_inbox', permission: 'messages.read' };
}

export function audienceOf(event: DomainEvent): Audience {
  const rule = AUDIENCE_RULES[event.type];
  return rule ? rule(event) : { kind: 'scope_all' };
}

function ownerVisible(viewer: SocketViewer, ownerId: string | null, nullOwnerPermission?: Permission): boolean {
  if (ownerId === null) return viewer.visibleUserIds === null || (nullOwnerPermission !== undefined && viewer.permissions.has(nullOwnerPermission));
  return viewer.visibleUserIds === null || viewer.visibleUserIds.has(ownerId);
}

/**
 * May this socket receive the event? `leadOwner` is the looked-up owner for `lead` audiences
 * (undefined = lookup failed or lead gone: only scope all receives it).
 */
export function maySee(viewer: SocketViewer, event: DomainEvent, audience: Audience, leadOwner?: string | null): boolean {
  if (event.workspaceId !== viewer.workspaceId) return false;
  if (event.userId) return event.userId === viewer.userId;
  switch (audience.kind) {
    case 'workspace':
      return true;
    case 'scope_all':
      return viewer.visibleUserIds === null;
    case 'permission':
      return viewer.permissions.has(audience.permission);
    case 'owners':
      if (audience.allowSelf && audience.ownerIds.includes(viewer.userId)) return true;
      if (audience.permission && !viewer.permissions.has(audience.permission)) return false;
      return audience.ownerIds.some((id) => ownerVisible(viewer, id, audience.nullOwnerPermission));
    case 'lead':
      if (!viewer.permissions.has('leads.read')) return false;
      if (leadOwner === undefined) return viewer.visibleUserIds === null || audience.fallbackOwnerIds.some((id) => id !== null && ownerVisible(viewer, id));
      return ownerVisible(viewer, leadOwner);
  }
}

/**
 * Viewers that could see the lead BEFORE an assignment but not after it: they get `sync.required`
 * for leads and board instead of the payload (the REST scope no longer shows them the lead).
 */
export function lostVisibility(viewer: SocketViewer, event: DomainEvent): boolean {
  if (event.type !== 'lead.assigned' || event.workspaceId !== viewer.workspaceId || viewer.visibleUserIds === null) return false;
  const p = (event as DomainEvent<'lead.assigned'>).payload;
  const before = p.fromUserId !== null && viewer.visibleUserIds.has(p.fromUserId);
  const after = p.toUserId !== null && viewer.visibleUserIds.has(p.toUserId);
  return before && !after;
}
