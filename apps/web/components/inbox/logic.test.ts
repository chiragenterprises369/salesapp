import { DEFAULT_ROLE_PERMISSIONS, type Message } from '@vistar/shared';
import { createWorldContext, HOUR_MS, mockTeams, mockUsers, worldInbox } from '@vistar/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { applyEdits, dayGroups, EMPTY_EDITS, filterConversations, fillQuickReply, inboxViews, scopeConversations, threadWithEdits, viewCounts, windowState, type InboxViewer } from './logic';

const NOW = Date.parse('2026-11-02T06:30:00.000Z');
const inbox = worldInbox(createWorldContext({ now: NOW }));
const list = inbox.conversations;
const users = mockUsers();
const admin = users.find((u) => u.role === 'company_admin')!;
const manager = users.find((u) => u.name === 'Priya Sharma')!;
const rep = users.find((u) => u.name === 'Rohit Verma')!;
const team = mockTeams().find((t) => t.managerId === manager.id)!;
const P = DEFAULT_ROLE_PERMISSIONS;

const v: Record<'admin' | 'manager' | 'employee', InboxViewer> = {
  admin: { userId: admin.id, visible: null, permissions: P.company_admin },
  manager: { userId: manager.id, visible: new Set(team.memberIds), permissions: P.manager },
  employee: { userId: rep.id, visible: new Set([rep.id]), permissions: P.employee },
};

describe('inbox views and scope', () => {
  it('views follow permissions and scope', () => {
    expect(inboxViews(v.employee)).toEqual(['mine']);
    expect(inboxViews(v.manager)).toEqual(['mine', 'all']);
    expect(inboxViews(v.admin)).toEqual(['mine', 'unassigned', 'all']);
  });

  it('employees only see chats assigned to them', () => {
    const rows = scopeConversations(list, v.employee);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.every((c) => c.assignee?.id === rep.id)).toBe(true);
  });

  it('managers see their team and no unassigned chats; admins see unassigned', () => {
    const rows = scopeConversations(list, v.manager);
    expect(rows.every((c) => !!c.assignee && team.memberIds.includes(c.assignee.id))).toBe(true);
    expect(filterConversations(list, { view: 'unassigned', status: 'any', q: '' }, v.manager)).toHaveLength(0);
    const un = filterConversations(list, { view: 'unassigned', status: 'any', q: '' }, v.admin);
    expect(un.length).toBe(list.filter((c) => !c.assignee).length);
    expect(un.length).toBeGreaterThan(0);
  });

  it('filters unread and search, newest first; unread counts per view', () => {
    const rows = filterConversations(list, { view: 'all', status: 'unread', q: '' }, v.admin);
    expect(rows.every((c) => c.unreadCount > 0)).toBe(true);
    for (let i = 1; i < rows.length; i++) expect((rows[i - 1]!.lastMessageAt ?? '') >= (rows[i]!.lastMessageAt ?? '')).toBe(true);
    const name = list[0]!.contactName;
    expect(filterConversations(list, { view: 'all', status: 'any', q: name }, v.admin).some((c) => c.contactName === name)).toBe(true);
    const counts = viewCounts(list, v.admin);
    expect(counts.all).toBe(rows.length);
    expect(counts.mine).toBe(0);
  });
});

describe('local edits', () => {
  const c = list.find((x) => x.unreadCount > 0)!;
  const sent: Message = { ...(inbox.messagesByConversation.get(c.id)![0]!), id: 'local-1', direction: 'outbound', isInternalNote: false, body: 'Hello', createdAt: new Date(NOW + 1000).toISOString() };
  it('sending updates preview, time, status and clears unread; notes do not change the preview', () => {
    const next = applyEdits(c, { ...EMPTY_EDITS, sent: { [c.id]: [sent] } });
    expect(next.lastMessagePreview).toBe('Hello');
    expect(next.status).toBe('pending');
    expect(next.unreadCount).toBe(0);
    const note = applyEdits(c, { ...EMPTY_EDITS, sent: { [c.id]: [{ ...sent, isInternalNote: true, body: 'note' }] } });
    expect(note.lastMessagePreview).toBe(c.lastMessagePreview);
    expect(threadWithEdits(inbox.messagesByConversation.get(c.id)!, c.id, { ...EMPTY_EDITS, sent: { [c.id]: [sent] } }).at(-1)!.id).toBe('local-1');
  });
  it('assignment and read marks apply', () => {
    expect(applyEdits(c, { ...EMPTY_EDITS, assignee: { [c.id]: null } }).assignee).toBeNull();
    expect(applyEdits(c, { ...EMPTY_EDITS, read: { [c.id]: true } }).unreadCount).toBe(0);
  });
});

describe('24 h window and helpers', () => {
  it('open within 24 h of the last inbound message', () => {
    expect(windowState({ lastInboundAt: new Date(NOW - 2 * HOUR_MS).toISOString() }, NOW)).toMatchObject({ open: true, msLeft: 22 * HOUR_MS });
    expect(windowState({ lastInboundAt: new Date(NOW - 25 * HOUR_MS).toISOString() }, NOW).open).toBe(false);
    expect(windowState({ lastInboundAt: null }, NOW)).toMatchObject({ open: false, neverInbound: true });
  });
  it('groups messages by IST day and fills quick replies', () => {
    const msgs = [...inbox.messagesByConversation.values()].find((m) => m.length > 4)!;
    const groups = dayGroups(msgs);
    expect(groups.reduce((a, g) => a + g.messages.length, 0)).toBe(msgs.length);
    expect(fillQuickReply('Namaste {name} ji', 'Rakesh Sharma')).toBe('Namaste Rakesh ji');
  });
});
