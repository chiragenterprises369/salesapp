'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Conversation, LeadListItem, Message, UserSummary } from '@vistar/shared';
import { renderTemplate, WHATSAPP_TEMPLATE_FIXTURES, worldUuid, rngFor } from '@vistar/shared/fixtures';
import { useMemo } from 'react';
import { create } from 'zustand';
import { toast } from '@/components/ui/toast';
import { useMe } from '@/lib/session/session';
import { notAvailableYet } from '@/lib/api/availability';
import { api } from '@/lib/api/client';
import { isMockData } from '@/lib/api/data-source';
import { viewerFromMe, worldContext } from '@/lib/world';
import { useConversation, useConversations } from '@/lib/world/hooks';
import { applyEdits, EMPTY_EDITS, threadWithEdits, type InboxEdits } from './logic';

/**
 * Inbox data adapter: GET /conversations and GET /conversations/{id}/messages (data scope on
 * Conversation.assigneeId) with local edits layered on top while a change is saved: replies,
 * internal notes, assign / transfer and read marks. API mode saves them with
 * POST /conversations/{id}/messages, /assign and /read; the test-only mock mode keeps them in this
 * tab and moves sent messages through sent -> delivered -> read like WhatsApp status webhooks would.
 */
interface InboxStore extends InboxEdits {
  addMessage: (conversationId: string, m: Message) => void;
  replaceMessage: (conversationId: string, localId: string, m: Message | null) => void;
  setStatus: (conversationId: string, messageId: string, status: Message['status']) => void;
  assign: (conversationId: string, user: UserSummary | null) => void;
  markRead: (conversationId: string) => void;
}

export const useInboxStore = create<InboxStore>()((set, get) => ({
  ...EMPTY_EDITS,
  addMessage: (id, m) => set((s) => ({ sent: { ...s.sent, [id]: [...(s.sent[id] ?? []), m] } })),
  replaceMessage: (id, localId, m) =>
    set((s) => ({ sent: { ...s.sent, [id]: (s.sent[id] ?? []).flatMap((x) => (x.id === localId ? (m ? [m] : []) : [x])) } })),
  setStatus: (id, mid, status) => set((s) => ({ sent: { ...s.sent, [id]: (s.sent[id] ?? []).map((m) => (m.id === mid ? { ...m, status } : m)) } })),
  assign: (id, user) => {
    const before = get().assignee;
    const had = id in before;
    const previous = before[id];
    set((s) => ({ assignee: { ...s.assignee, [id]: user } }));
    if (isMockData()) return;
    api.call('conversationAssign', { params: { id }, body: { assigneeId: user?.id ?? null } }).catch(() => {
      set((s) => {
        const next = { ...s.assignee };
        if (had) next[id] = previous ?? null;
        else delete next[id];
        return { assignee: next };
      });
      toast.error('The chat was not reassigned', { description: 'Check your connection and try again.' });
    });
  },
  markRead: (id) => {
    if (get().read[id]) return;
    set((s) => ({ read: { ...s.read, [id]: true } }));
    if (!isMockData()) void api.call('conversationRead', { params: { id } }).catch(() => undefined);
  },
}));

function useEdits(): InboxEdits {
  const sent = useInboxStore((s) => s.sent);
  const assignee = useInboxStore((s) => s.assignee);
  const read = useInboxStore((s) => s.read);
  return useMemo(() => ({ sent, assignee, read }), [sent, assignee, read]);
}

export function useInboxViewer() {
  const me = useMe();
  return useMemo(() => viewerFromMe(me), [me]);
}

/** Every conversation in scope with local edits applied (the page filters on the client). */
export function useInbox() {
  const q = useConversations({ limit: 5_000 });
  const edits = useEdits();
  const data = useMemo<Conversation[] | undefined>(() => q.data?.items.map((c) => applyEdits(c, edits)), [q.data, edits]);
  return { ...q, data };
}

/** One conversation and its messages (oldest first) with local edits applied. */
export function useThread(id: string | null) {
  const q = useConversation(id);
  const edits = useEdits();
  const data = useMemo(() => {
    if (!q.data || !id) return undefined;
    return { conversation: applyEdits(q.data.conversation, edits), messages: threadWithEdits(q.data.messages, id, edits) };
  }, [q.data, edits, id]);
  return { ...q, data };
}

/** Lead of a conversation for template variables (mock mode only; the API inbox carries lead names). */
export const leadOf = (leadId: string | null): LeadListItem | null => (leadId && isMockData() ? (worldContext().leadById.get(leadId) ?? null) : null);

/** Approved WhatsApp templates (GET /templates once WhatsApp is connected; sample templates in mock mode). */
export const INBOX_TEMPLATES = isMockData() ? WHATSAPP_TEMPLATE_FIXTURES : [];

export function templatePreview(name: string, conversation: Conversation): string {
  const lead = leadOf(conversation.leadId);
  if (lead) return renderTemplate(name, lead);
  const t = WHATSAPP_TEMPLATE_FIXTURES.find((x) => x.name === name);
  return (t?.body ?? name).replace('{{1}}', conversation.contactName.split(' ')[0] ?? '');
}

let seq = 0;
const newId = () => worldUuid(rngFor(`local-msg:${Date.now()}:${seq++}`));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Outgoing = { kind: 'text'; body: string } | { kind: 'note'; body: string } | { kind: 'template'; name: string };

/** Send a reply, template or internal note: shows at once (optimistic), then delivery ticks update. */
export function useSendMessage(conversation: Conversation | null, author: UserSummary | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (out: Outgoing) => {
      if (!conversation) throw new Error('No conversation');
      const store = useInboxStore.getState();
      const m: Message = {
        id: newId(),
        conversationId: conversation.id,
        direction: 'outbound',
        type: out.kind === 'template' ? 'template' : out.kind === 'note' ? 'note' : 'text',
        body: out.kind === 'template' ? templatePreview(out.name, conversation) : out.body,
        templateName: out.kind === 'template' ? out.name : null,
        media: null,
        status: out.kind === 'note' ? 'read' : 'queued',
        error: null,
        isInternalNote: out.kind === 'note',
        author,
        createdAt: new Date().toISOString(),
      };
      if (!isMockData()) {
        // Approved templates come from GET /templates once WhatsApp is connected (none until then).
        if (out.kind === 'template') throw notAvailableYet('WhatsApp templates');
        store.addMessage(conversation.id, m);
        try {
          const saved = await api.call('messageSend', { params: { id: conversation.id }, body: { type: out.kind, body: out.body } });
          store.replaceMessage(conversation.id, m.id, saved);
          void qc.invalidateQueries({ queryKey: ['conversations'] });
          return saved;
        } catch (e) {
          store.replaceMessage(conversation.id, m.id, null);
          throw e;
        }
      }
      store.addMessage(conversation.id, m);
      if (out.kind === 'note') return m;
      await wait(300);
      store.setStatus(conversation.id, m.id, 'sent');
      void wait(1_200).then(() => useInboxStore.getState().setStatus(conversation.id, m.id, 'delivered'));
      void wait(4_000).then(() => useInboxStore.getState().setStatus(conversation.id, m.id, 'read'));
      return m;
    },
  });
}
