'use client';

import type { Message } from '@vistar/shared';
import { AlertCircle, Check, CheckCheck, Clock, FileText, StickyNote, Zap } from 'lucide-react';
import { formatTimeIn } from '@/components/common/time';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/cn';

const STATUS_LABEL: Record<Message['status'], string> = { queued: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Not delivered' };

function Ticks({ status }: { status: Message['status'] }) {
  const Icon = status === 'queued' ? Clock : status === 'sent' ? Check : status === 'failed' ? AlertCircle : CheckCheck;
  return (
    <span className={cn('inline-flex items-center', status === 'read' ? 'text-accent-text' : status === 'failed' ? 'text-danger-text' : 'text-muted-strong')} title={STATUS_LABEL[status]}>
      <Icon aria-hidden className="size-3.5" />
      <span className="sr-only">{STATUS_LABEL[status]}</span>
    </span>
  );
}

const kb = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.round(n / 1000)} KB`);

/** One chat message: inbound left, outbound right, internal notes as amber notes, template chip, document card, delivery ticks. */
export function MessageBubble({ m, timeZone }: { m: Message; timeZone: string }) {
  const time = formatTimeIn(m.createdAt, timeZone);
  if (m.isInternalNote)
    return (
      <li className="flex justify-center px-2">
        <div className="w-full max-w-xl rounded-md border border-status-amber-border bg-status-amber-bg px-3 py-2 text-status-amber-fg">
          <p className="flex items-center gap-1.5 text-2xs font-semibold">
            <StickyNote aria-hidden className="size-3.5" />
            Internal note{m.author ? ` · ${m.author.name}` : ''} · {time}
          </p>
          <p className="mt-0.5 text-sm whitespace-pre-wrap">{m.body}</p>
          <p className="sr-only">Only your team can see this note.</p>
        </div>
      </li>
    );
  const out = m.direction === 'outbound';
  return (
    <li className={cn('flex px-2', out ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg border px-3 py-2 shadow-card sm:max-w-[70%]',
          out ? 'rounded-br-xs border-status-indigo-border bg-accent-soft text-accent-soft-fg' : 'rounded-bl-xs border-border bg-surface text-fg',
          m.status === 'failed' && 'border-status-red-border',
        )}
      >
        <p className="sr-only">{out ? (m.author ? `${m.author.name} wrote` : 'Automation sent') : 'Customer wrote'}</p>
        {m.type === 'template' && m.templateName && (
          <Chip tone="indigo" className="mb-1">
            <Zap aria-hidden />
            Template · {m.templateName}
          </Chip>
        )}
        {m.media && (
          <span className="mb-1 flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-fg">
            <FileText aria-hidden className="size-5 shrink-0 text-fg-secondary" />
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium">{m.media.name ?? 'Document'}</span>
              <span className="block text-2xs text-muted">
                {m.media.mime === 'application/pdf' ? 'PDF' : m.media.mime} · {kb(m.media.size)}
              </span>
            </span>
          </span>
        )}
        {m.body && <p className="text-sm break-words whitespace-pre-wrap">{m.body}</p>}
        <p className={cn('mt-1 flex items-center justify-end gap-1 text-2xs', out ? 'text-accent-soft-fg' : 'text-muted')}>
          {out && <span className="mr-auto truncate pr-2">{m.author ? m.author.name : 'Automation'}</span>}
          <span className="tabular">{time}</span>
          {out && <Ticks status={m.status} />}
        </p>
        {m.status === 'failed' && m.error && <p className="mt-1 text-2xs text-danger-text">{m.error}</p>}
      </div>
    </li>
  );
}
