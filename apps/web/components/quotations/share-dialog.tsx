'use client';

import type { DocumentShare } from '@vistar/shared';
import { Copy, ExternalLink, Mail, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { formatDateTimeIn } from '@/lib/crm/format';

/** Share link of a quotation or invoice: copy, open, WhatsApp or email the ready message. Shown right after it is created (the token is shown once). */
export function ShareDialog({ share, onClose, buyerPhone, buyerEmail, timeZone, title }: { share: DocumentShare; onClose: () => void; buyerPhone: string | null; buyerEmail: string | null; timeZone: string; title: string }) {
  const [message, setMessage] = useState(share.message);
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error('Copy did not work in this browser. Select the text and copy it.');
    }
  };
  const wa = `https://wa.me/${buyerPhone ? buyerPhone.replace('+', '') : ''}?text=${encodeURIComponent(message)}`;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Anyone with the link can view and download the PDF until {formatDateTimeIn(share.expiresAt, timeZone)}. Creating a new link turns this one off.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-secondary">Link</span>
              <span className="flex gap-1.5">
                <Input readOnly value={share.url} onFocus={(e) => e.currentTarget.select()} />
                <Button size="icon" aria-label="Copy link" onClick={() => void copy(share.url, 'Link')}>
                  <Copy aria-hidden />
                </Button>
                <Button asChild size="icon" aria-label="Open the shared page">
                  <a href={share.url} target="_blank" rel="noreferrer">
                    <ExternalLink aria-hidden />
                  </a>
                </Button>
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-secondary">Message</span>
              <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <a href={wa} target="_blank" rel="noreferrer">
                  <MessageCircle aria-hidden />
                  {buyerPhone ? 'Send on WhatsApp' : 'Share on WhatsApp'}
                </a>
              </Button>
              <Button asChild>
                <a href={`mailto:${buyerEmail ?? ''}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(message)}`}>
                  <Mail aria-hidden />
                  Email
                </a>
              </Button>
              <Button variant="ghost" onClick={() => void copy(message, 'Message')}>
                <Copy aria-hidden />
                Copy message
              </Button>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="primary">Done</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
