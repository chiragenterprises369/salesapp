import type { Conversation, Message, UserSummary } from '@vistar/shared';
import { DAY_MS, HOUR_MS, istDayStart } from '@vistar/shared/fixtures';

/**
 * Pure inbox helpers: list views by permission, filters, local edits (sent messages, assignment,
 * read marks), the 24 h customer-service window and day groups. Tested in ./logic.test.ts.
 */

export type InboxView = 'mine' | 'unassigned' | 'all';
export type InboxStatusFilter = 'any' | 'unread' | 'open' | 'pending' | 'closed';

export interface InboxViewer {
  userId: string | null;
  visible: ReadonlySet<string> | null;
  permissions: readonly string[];
}

/** Views a person may switch between: Mine always; All (team or workspace) with team inbox; Unassigned with all scope. */
export function inboxViews(v: InboxViewer): InboxView[] {
  const views: InboxView[] = ['mine'];
  if (v.visible === null) views.push('unassigned');
  if (v.permissions.includes('messages.team_inbox')) views.push('all');
  return views;
}

/** Conversations the viewer may see at all (Conversation.assigneeId in scope; unassigned needs all scope). */
export function scopeConversations(list: readonly Conversation[], v: InboxViewer): Conversation[] {
  if (!v.userId) return [];
  return list.filter((c) => v.visible === null || (!!c.assignee && v.visible.has(c.assignee.id)));
}

export function inView(c: Conversation, view: InboxView, v: InboxViewer): boolean {
  if (view === 'mine') return c.assignee?.id === v.userId;
  if (view === 'unassigned') return c.assignee === null;
  return true;
}

export function matchesStatus(c: Conversation, s: InboxStatusFilter): boolean {
  if (s === 'any') return true;
  if (s === 'unread') return c.unreadCount > 0;
  return c.status === s;
}

export function matchesSearch(c: Conversation, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  const digits = n.replace(/\D/g, '');
  return `${c.contactName} ${c.lastMessagePreview ?? ''}`.toLowerCase().includes(n) || (digits.length >= 3 && c.contactPhone.includes(digits));
}

const byLatest = (a: Conversation, b: Conversation) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '');

export function filterConversations(list: readonly Conversation[], o: { view: InboxView; status: InboxStatusFilter; q: string }, v: InboxViewer): Conversation[] {
  return scopeConversations(list, v)
    .filter((c) => inView(c, o.view, v) && matchesStatus(c, o.status) && matchesSearch(c, o.q))
    .sort(byLatest);
}

export function viewCounts(list: readonly Conversation[], v: InboxViewer): Record<InboxView, number> {
  const scoped = scopeConversations(list, v);
  const unread = (view: InboxView) => scoped.filter((c) => inView(c, view, v) && c.unreadCount > 0).length;
  return { mine: unread('mine'), unassigned: unread('unassigned'), all: unread('all') };
}

// ---------------------------------------------------------------- local edits (mock store)

export interface InboxEdits {
  /** Messages sent or notes added in this tab, per conversation (oldest first). */
  sent: Record<string, Message[]>;
  /** Assignment changes: conversation id -> new assignee (null = unassigned). */
  assignee: Record<string, UserSummary | null>;
  /** Conversations opened in this tab (unread cleared). */
  read: Record<string, true>;
}

export const EMPTY_EDITS: InboxEdits = { sent: {}, assignee: {}, read: {} };

export function applyEdits(c: Conversation, e: InboxEdits): Conversation {
  let next = c;
  if (c.id in e.assignee) next = { ...next, assignee: e.assignee[c.id] ?? null };
  if (e.read[c.id] && next.unreadCount) next = { ...next, unreadCount: 0 };
  const visible = (e.sent[c.id] ?? []).filter((m) => !m.isInternalNote);
  const last = visible[visible.length - 1];
  if (last && (!next.lastMessageAt || last.createdAt > next.lastMessageAt))
    next = { ...next, lastMessageAt: last.createdAt, lastMessagePreview: (last.body ?? 'Message').slice(0, 120), status: 'pending', unreadCount: 0 };
  return next;
}

export function threadWithEdits(messages: readonly Message[], conversationId: string, e: InboxEdits): Message[] {
  const extra = e.sent[conversationId];
  return extra?.length ? [...messages, ...extra] : [...messages];
}

// ---------------------------------------------------------------- 24 h window

export interface WindowState {
  open: boolean;
  /** Ms until the window closes (0 when closed). */
  msLeft: number;
  /** The customer has never written: only templates can start the chat. */
  neverInbound: boolean;
}

export function windowState(c: Pick<Conversation, 'lastInboundAt'>, now: number): WindowState {
  if (!c.lastInboundAt) return { open: false, msLeft: 0, neverInbound: true };
  const left = Date.parse(c.lastInboundAt) + 24 * HOUR_MS - now;
  return { open: left > 0, msLeft: Math.max(0, left), neverInbound: false };
}

/** "5h 12m", "38m". */
export function formatLeft(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

/** Messages grouped by IST day (for date separators). */
export function dayGroups(messages: readonly Message[]): Array<{ day: number; messages: Message[] }> {
  const out: Array<{ day: number; messages: Message[] }> = [];
  for (const m of messages) {
    const day = istDayStart(Date.parse(m.createdAt));
    const last = out[out.length - 1];
    if (last && last.day === day) last.messages.push(m);
    else out.push({ day, messages: [m] });
  }
  return out;
}

export function dayLabel(day: number, now: number, timeZone: string): string {
  const today = istDayStart(now);
  if (day === today) return 'Today';
  if (day === today - DAY_MS) return 'Yesterday';
  return new Intl.DateTimeFormat('en-IN', { timeZone, weekday: 'short', day: 'numeric', month: 'short', year: day < today - 300 * DAY_MS ? 'numeric' : undefined }).format(new Date(day + HOUR_MS));
}

/** List timestamp: time today, "Yesterday", else "28 Oct". */
export function listTime(iso: string | null, now: number, timeZone: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  const day = istDayStart(t);
  const today = istDayStart(now);
  if (day === today) return new Intl.DateTimeFormat('en-IN', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(t));
  if (day === today - DAY_MS) return 'Yesterday';
  return new Intl.DateTimeFormat('en-IN', { timeZone, day: 'numeric', month: 'short' }).format(new Date(t));
}

// ---------------------------------------------------------------- quick replies

export interface QuickReplyItem {
  id: string;
  shortcut: string;
  body: string;
}

/** Workspace quick replies (mock; Wave 3: GET /quick-replies). `{name}` is the contact's first name. */
export const QUICK_REPLIES: readonly QuickReplyItem[] = [
  { id: 'qr-price', shortcut: '/price', body: 'Namaste {name} ji, our latest prices are ex-works and exclude GST. Shall I share a formal quotation?' },
  { id: 'qr-delivery', shortcut: '/delivery', body: 'Delivery takes 5 to 7 working days after the order is confirmed. We ship across India.' },
  { id: 'qr-gst', shortcut: '/gst', body: 'Please share your GST number and billing address so we can prepare the invoice.' },
  { id: 'qr-callback', shortcut: '/callback', body: 'Thank you, {name} ji. Our team will call you back within 30 minutes.' },
  { id: 'qr-samples', shortcut: '/samples', body: 'We can send samples. Please share the delivery address and the quantity you need.' },
  { id: 'qr-thanks', shortcut: '/thanks', body: 'Thank you for your order! We will share the dispatch details shortly.' },
];

export function fillQuickReply(body: string, contactName: string): string {
  return body.replaceAll('{name}', contactName.trim().split(/\s+/)[0] ?? contactName);
}
