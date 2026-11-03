'use client';

import { ExternalLink, FileText, Image as ImageIcon, Phone, Reply, Video } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface WhatsAppBubbleButton {
  type: string;
  text: string;
}

export interface WhatsAppBubbleProps {
  /** Text header, or a media header kind ('image' | 'video' | 'document'). */
  header?: { kind: 'text'; text: string } | { kind: 'image' | 'video' | 'document' } | null;
  body: string;
  footer?: string | null;
  buttons?: readonly WhatsAppBubbleButton[];
  /** Sample values for {{1}}, {{2}} ... (index 0 = {{1}}). */
  samples?: readonly string[];
  /** Name shown above the chat (the company's WhatsApp display name). */
  businessName?: string;
  className?: string;
}

const VAR_RE = /\{\{\s*(\d{1,2})\s*\}\}/g;

/** WhatsApp inline formatting: *bold*, _italic_, ~strike~ (no HTML; React nodes only). */
function formatInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const inner = m[0].slice(1, -1);
    const k = `${keyBase}-${i++}`;
    if (m[0].startsWith('*')) out.push(<strong key={k}>{inner}</strong>);
    else if (m[0].startsWith('_')) out.push(<em key={k}>{inner}</em>);
    else out.push(<s key={k}>{inner}</s>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Body with numbered variables filled from the samples (highlighted) or shown as {{n}} when no sample. */
function renderBody(body: string, samples: readonly string[]): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of body.matchAll(VAR_RE)) {
    if (m.index > last) out.push(...formatInline(body.slice(last, m.index), `t${i}`));
    const n = Number(m[1]);
    const sample = samples[n - 1]?.trim();
    out.push(
      <mark key={`v${i}`} className={cn('rounded-xs px-0.5', sample ? 'bg-accent-soft text-accent-soft-fg' : 'bg-status-amber-bg text-status-amber-fg')}>
        {sample || `{{${n}}}`}
      </mark>,
    );
    last = m.index + m[0].length;
    i++;
  }
  if (last < body.length) out.push(...formatInline(body.slice(last), `t${i}`));
  return out;
}

const BUTTON_ICON: Record<string, typeof Reply> = { quick_reply: Reply, url: ExternalLink, phone_number: Phone, phone: Phone };
const MEDIA_ICON = { image: ImageIcon, video: Video, document: FileText } as const;

/**
 * Preview of a WhatsApp message template as the customer sees it: a chat bubble with the header, the
 * body (variables filled with the sample values), the footer and the buttons. Theme tokens only.
 */
export function WhatsAppBubble({ header, body, footer, buttons = [], samples = [], businessName, className }: WhatsAppBubbleProps) {
  const MediaIcon = header && header.kind !== 'text' ? MEDIA_ICON[header.kind] : null;
  return (
    <figure className={cn('flex min-w-0 flex-col gap-1.5', className)} aria-label="WhatsApp preview">
      <figcaption className="text-xs font-medium text-fg-secondary">{businessName ? `As ${businessName} on WhatsApp` : 'WhatsApp preview'}</figcaption>
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <div className="max-w-sm">
          <div className="overflow-hidden rounded-lg rounded-tl-xs border border-border bg-surface shadow-card">
            {MediaIcon && (
              <div className="flex h-32 items-center justify-center bg-surface-3 text-muted-strong">
                <MediaIcon aria-hidden className="size-6" />
                <span className="sr-only">{`${header!.kind} header`}</span>
              </div>
            )}
            <div className="flex flex-col gap-1 px-3 py-2 text-sm text-fg">
              {header?.kind === 'text' && header.text.trim() && <p className="font-semibold break-words">{renderBody(header.text, samples)}</p>}
              <p className="break-words whitespace-pre-wrap">{body.trim() ? renderBody(body, samples) : <span className="text-muted-strong">The message body appears here.</span>}</p>
              {footer?.trim() && <p className="text-xs break-words text-muted-strong">{footer}</p>}
              <p className="self-end text-2xs text-muted-strong tabular" aria-hidden>
                10:42
              </p>
            </div>
            {buttons.length > 0 && (
              <ul className="divide-y divide-border border-t border-border">
                {buttons.map((b, i) => {
                  const Icon = BUTTON_ICON[b.type] ?? Reply;
                  return (
                    <li key={`${b.type}-${i}`} className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-accent-text">
                      <Icon aria-hidden className="size-3.5" />
                      <span className="truncate">{b.text || 'Button'}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </figure>
  );
}

/** Highest {{n}} used in a text (0 when none). */
export function maxVariableIndex(...texts: ReadonlyArray<string | null | undefined>): number {
  let max = 0;
  for (const t of texts) for (const m of (t ?? '').matchAll(VAR_RE)) max = Math.max(max, Number(m[1]));
  return max;
}
