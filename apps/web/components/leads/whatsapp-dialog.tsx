'use client';

import type { LeadListItem } from '@vistar/shared';
import { WHATSAPP_TEMPLATE_FIXTURES, type WhatsAppTemplateFixture } from '@vistar/shared/fixtures';
import { MessageCircle } from 'lucide-react';
import { RadioGroup } from 'radix-ui';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/cn';
import { useMe } from '@/lib/session/session';
import { firstName, formatPhone } from './lead-meta';

/** Stable mock ids for the fixture templates (API: WhatsAppTemplate.id). */
export const WHATSAPP_TEMPLATES = WHATSAPP_TEMPLATE_FIXTURES.map((t, i) => ({
  ...t,
  id: `0190f5a0-0000-7000-8000-9000000000${String(i).padStart(2, '0')}`,
  label: t.name
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .replace(/indiamart/i, 'IndiaMART'),
}));
export type WhatsAppTemplate = (typeof WHATSAPP_TEMPLATES)[number];

export function renderTemplate(
  t: WhatsAppTemplateFixture,
  lead: Pick<LeadListItem, 'name'> | null,
  workspaceName: string,
): string {
  return t.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => {
    const variable = t.variables[Number(n) - 1];
    if (variable === 'lead.firstName') return lead ? firstName(lead.name) : 'there';
    if (variable === 'workspace.name') return workspaceName;
    if (variable === 'lead.productInterest') return 'your requirement';
    return `{{${n}}}`;
  });
}

export interface WhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One lead (composer) or several (bulk). The preview uses the first lead. */
  leads: Array<Pick<LeadListItem, 'id' | 'name' | 'phone'>>;
  /** Total selected when sending in bulk (some may not be loaded). */
  count?: number;
  sending?: boolean;
  onSend: (template: WhatsAppTemplate) => void | Promise<void>;
}

/** WhatsApp template picker with a live preview. Outside the 24 h window only approved templates can be sent. */
export function WhatsAppDialog({
  open,
  onOpenChange,
  leads,
  count,
  sending,
  onSend,
}: WhatsAppDialogProps) {
  const me = useMe();
  const [templateId, setTemplateId] = useState(WHATSAPP_TEMPLATES[0]!.id);
  const template = WHATSAPP_TEMPLATES.find((t) => t.id === templateId) ?? WHATSAPP_TEMPLATES[0]!;
  const total = count ?? leads.length;
  const single = total === 1 ? leads[0] : null;
  const preview = renderTemplate(template, leads[0] ?? null, me?.workspace.name ?? 'our team');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>
            {single ? `WhatsApp ${single.name}` : `Send WhatsApp template to ${total} leads`}
          </DialogTitle>
          <DialogDescription>
            {single
              ? `To ${formatPhone(single.phone)}. Pick an approved template; free text opens once the lead replies.`
              : 'Variables are filled for each lead. Leads without a phone number or WhatsApp consent are skipped.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <RadioGroup.Root
            value={templateId}
            onValueChange={setTemplateId}
            aria-label="Template"
            className="flex flex-col gap-1.5"
            loop
          >
            {WHATSAPP_TEMPLATES.map((t) => (
              <RadioGroup.Item
                key={t.id}
                value={t.id}
                className={cn(
                  'focus-ring flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition-colors duration-150',
                  t.id === templateId
                    ? 'border-status-indigo-border bg-accent-soft'
                    : 'border-border bg-surface hover:bg-surface-2',
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span
                    className={cn(
                      'text-sm font-medium',
                      t.id === templateId ? 'text-accent-soft-fg' : 'text-fg',
                    )}
                  >
                    {t.label}
                  </span>
                  <Chip tone={t.category === 'marketing' ? 'amber' : 'neutral'}>
                    {t.category === 'marketing' ? 'Marketing' : 'Utility'}
                  </Chip>
                </span>
                <span
                  className={cn(
                    'line-clamp-1 text-xs',
                    t.id === templateId ? 'text-muted-strong' : 'text-muted',
                  )}
                >
                  {t.body}
                </span>
              </RadioGroup.Item>
            ))}
          </RadioGroup.Root>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-fg-secondary">
              Preview{leads[0] && !single ? ` for ${leads[0].name}` : ''}
            </span>
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <div className="ml-auto max-w-[90%] rounded-lg rounded-tr-xs border border-status-green-border bg-status-green-bg p-3 text-sm text-fg">
                <p className="whitespace-pre-wrap">{preview}</p>
                <p className="mt-1 text-right text-2xs text-muted-strong">
                  Template · {template.name}
                </p>
              </div>
            </div>
            {template.category === 'marketing' && (
              <p className="text-xs text-warning-text">
                Marketing template: sent only to leads who opted in to WhatsApp.
              </p>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button variant="primary" loading={sending} onClick={() => void onSend(template)}>
            <MessageCircle aria-hidden />
            {single ? 'Send template' : `Send to ${total} leads`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
