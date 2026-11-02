'use client';

import type { Conversation } from '@vistar/shared';
import { MessageSquareText, Send, StickyNote, Zap } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/common/popover';
import { FilterPills, TOUCH } from '@/components/reports/page-kit';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { INBOX_TEMPLATES, templatePreview, type Outgoing } from './data';
import { fillQuickReply, QUICK_REPLIES, type WindowState } from './logic';

/**
 * Composer: reply or internal note, quick replies, template chips. Outside the 24 h window (or before
 * the customer has written) only approved templates can be sent; opted-out contacts get notes only.
 * Enter sends, Shift+Enter adds a line.
 */
export function Composer({ conversation, window: w, onSend, sending, touch }: { conversation: Conversation; window: WindowState; onSend: (o: Outgoing) => void; sending: boolean; touch?: boolean }) {
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [text, setText] = useState('');
  const id = useId();
  const optedOut = conversation.optIn === 'opted_out';
  const replyBlocked = mode === 'reply' && (!w.open || optedOut);
  const canSendText = text.trim().length > 0 && !replyBlocked && !sending;

  const send = () => {
    if (!canSendText) return;
    onSend(mode === 'note' ? { kind: 'note', body: text.trim() } : { kind: 'text', body: text.trim() });
    setText('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const sendTemplate = (name: string) => {
    onSend({ kind: 'template', name });
    toast.success('Template sent', { description: `${name} to ${conversation.contactName}` });
  };

  const hint = optedOut
    ? 'This contact opted out of WhatsApp messages. You can still add internal notes.'
    : !w.open
      ? w.neverInbound
        ? 'The customer has not written yet. Start the chat with an approved template.'
        : 'The 24 h window is closed. Send an approved template to restart the chat.'
      : null;

  return (
    <div className="shrink-0 border-t border-border bg-surface px-3 py-2.5 spatial:bg-transparent">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <FilterPills
          label="Message type"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'reply', label: 'Reply' },
            { value: 'note', label: 'Internal note' },
          ]}
        />
        {mode === 'reply' && !optedOut && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5" role="group" aria-label="Templates">
            <span className="hidden text-2xs text-muted-strong sm:inline">Templates</span>
            {INBOX_TEMPLATES.slice(0, 3).map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => sendTemplate(t.name)}
                disabled={sending}
                title={templatePreview(t.name, conversation)}
                className={cn('focus-ring rounded-full disabled:opacity-50', TOUCH)}
                aria-label={`Send template ${t.name}`}
              >
                <Chip tone="indigo" size="md">
                  <Zap aria-hidden />
                  {t.name}
                </Chip>
              </button>
            ))}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className={TOUCH}>
                  All templates
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-1" align="end">
                <p className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted">Approved WhatsApp templates</p>
                <ul className="max-h-72 overflow-y-auto">
                  {INBOX_TEMPLATES.map((t) => (
                    <li key={t.name}>
                      <PopoverClose asChild>
                        <button type="button" onClick={() => sendTemplate(t.name)} className="focus-ring flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-3">
                          <span className="flex items-center gap-1.5 text-xs font-medium text-fg">
                            {t.name}
                            <Chip>{t.category === 'marketing' ? 'Marketing' : 'Utility'}</Chip>
                          </span>
                          <span className="line-clamp-2 text-xs text-muted">{templatePreview(t.name, conversation)}</span>
                        </button>
                      </PopoverClose>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
      {hint && mode === 'reply' && (
        <p className="mb-2 rounded-md border border-status-amber-border bg-status-amber-bg px-2.5 py-1.5 text-xs text-status-amber-fg" role="note">
          {hint}
        </p>
      )}
      <div className="flex items-end gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" size={touch ? 'icon-touch' : 'icon'} aria-label="Quick replies" disabled={replyBlocked} className={TOUCH}>
              <MessageSquareText aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-1" align="start" side="top">
            <p className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted">Quick replies</p>
            <ul className="max-h-72 overflow-y-auto">
              {QUICK_REPLIES.map((r) => (
                <li key={r.id}>
                  <PopoverClose asChild>
                    <button
                      type="button"
                      onClick={() => setText(fillQuickReply(r.body, conversation.contactName))}
                      className="focus-ring flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-3"
                    >
                      <span className="font-mono text-xs font-medium text-accent-text">{r.shortcut}</span>
                      <span className="line-clamp-2 text-xs text-fg-secondary">{fillQuickReply(r.body, conversation.contactName)}</span>
                    </button>
                  </PopoverClose>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
        <label htmlFor={id} className="sr-only">
          {mode === 'note' ? 'Internal note (only your team sees it)' : `Reply to ${conversation.contactName}`}
        </label>
        <textarea
          id={id}
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            const qr = QUICK_REPLIES.find((r) => v.trim() === r.shortcut);
            setText(qr ? fillQuickReply(qr.body, conversation.contactName) : v);
          }}
          onKeyDown={onKeyDown}
          disabled={replyBlocked}
          rows={touch ? 2 : 1}
          placeholder={replyBlocked ? 'Templates only' : mode === 'note' ? 'Add a note for your team' : 'Type a reply. Type /price for a quick reply.'}
          className={cn(
            'max-h-32 min-h-9 w-full min-w-0 flex-1 resize-none rounded-md border border-input bg-surface px-2.5 py-2 text-sm text-fg shadow-card placeholder:text-muted',
            'focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60',
            'pointer-coarse:min-h-11 pointer-coarse:text-base',
            mode === 'note' && 'border-status-amber-border bg-status-amber-bg text-status-amber-fg',
          )}
        />
        <Button variant="primary" size={touch ? 'icon-touch' : 'icon'} className={TOUCH} onClick={send} disabled={!canSendText} aria-label={mode === 'note' ? 'Add note' : 'Send reply'}>
          {mode === 'note' ? <StickyNote aria-hidden /> : <Send aria-hidden />}
        </Button>
      </div>
    </div>
  );
}
