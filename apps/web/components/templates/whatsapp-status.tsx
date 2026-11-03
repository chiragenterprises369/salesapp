import type { ChipTone, TemplateCategory, TemplateStatus } from '@vistar/shared';
import { Chip } from '@/components/ui/chip';

export const WA_STATUS: Record<TemplateStatus, { label: string; tone: ChipTone; hint: string }> = {
  draft: { label: 'Draft', tone: 'grey', hint: 'Not sent to Meta yet.' },
  pending: { label: 'In review', tone: 'amber', hint: 'Meta is reviewing it (usually minutes, up to 24 hours).' },
  approved: { label: 'Approved', tone: 'green', hint: 'Ready to send, also outside the 24-hour window.' },
  rejected: { label: 'Rejected', tone: 'red', hint: 'Meta rejected it. Edit and submit again.' },
  paused: { label: 'Paused', tone: 'grey', hint: 'Meta paused it after low quality ratings.' },
};

export function WhatsAppStatusChip({ status }: { status: TemplateStatus }) {
  const s = WA_STATUS[status];
  return (
    <Chip tone={s.tone} dot title={s.hint}>
      {s.label}
    </Chip>
  );
}

export const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  marketing: 'Marketing',
  utility: 'Utility',
  authentication: 'Authentication',
};

export const CATEGORY_HELP: Record<TemplateCategory, string> = {
  marketing: 'Offers, catalogues, re-engagement. Needs the customer\'s opt-in.',
  utility: 'Updates the customer expects: quotations, orders, payments, appointments.',
  authentication: 'One-time codes only.',
};

/** Meta language codes offered in the editor (Indian languages first after English). */
export const WA_LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'en_US', label: 'English (US)' },
  { value: 'en_GB', label: 'English (UK)' },
  { value: 'hi', label: 'Hindi' },
  { value: 'mr', label: 'Marathi' },
  { value: 'gu', label: 'Gujarati' },
  { value: 'ta', label: 'Tamil' },
  { value: 'te', label: 'Telugu' },
  { value: 'kn', label: 'Kannada' },
  { value: 'bn', label: 'Bengali' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'pa', label: 'Punjabi' },
];

export const languageLabel = (code: string) => WA_LANGUAGES.find((l) => l.value === code)?.label ?? code;
