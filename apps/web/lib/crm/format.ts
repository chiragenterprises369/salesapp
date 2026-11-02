import type { ChipTone, InvoiceStatus, MeetingMode, MeetingStatus, PaymentMode, QuotationStatus, StageType } from '@vistar/shared';

/** Labels and chip tones for CRM statuses (sentence case, soft chips only). */
export const QUOTATION_STATUS: Record<QuotationStatus, { label: string; tone: ChipTone }> = {
  draft: { label: 'Draft', tone: 'grey' },
  sent: { label: 'Sent', tone: 'blue' },
  accepted: { label: 'Accepted', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  expired: { label: 'Expired', tone: 'amber' },
};

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: ChipTone }> = {
  draft: { label: 'Draft', tone: 'grey' },
  issued: { label: 'Issued', tone: 'blue' },
  partially_paid: { label: 'Partially paid', tone: 'amber' },
  paid: { label: 'Paid', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'red' },
};

export const DEAL_STATUS: Record<StageType, { label: string; tone: ChipTone }> = {
  open: { label: 'Open', tone: 'blue' },
  won: { label: 'Won', tone: 'green' },
  lost: { label: 'Lost', tone: 'red' },
};

export const MEETING_STATUS: Record<MeetingStatus, { label: string; tone: ChipTone }> = {
  scheduled: { label: 'Scheduled', tone: 'indigo' },
  completed: { label: 'Completed', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'grey' },
};

export const MEETING_MODE: Record<MeetingMode, string> = { in_person: 'In person', video: 'Video call', phone: 'Phone call' };

export const PAYMENT_MODE: Record<PaymentMode, string> = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer', cheque: 'Cheque', card: 'Card', other: 'Other' };

/** "3 Nov 2026" for a YYYY-MM-DD date (no time zone shift). */
export function formatDay(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)));
}

/** "3 Nov 2026" for an instant in the workspace zone. */
export function formatDateIn(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(new Date(iso));
}

/** "3 Nov, 2:30 pm" in the workspace zone. */
export function formatDateTimeIn(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(new Date(iso));
}

/** Today as YYYY-MM-DD in the zone. */
export function todayIn(timeZone: string, now: number): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  return p;
}

/** Relative age ("3 days ago") for list columns; empty for null. */
export function ago(iso: string | null | undefined, now: number): string {
  if (!iso || !now) return '';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} ${d === 1 ? 'day' : 'days'} ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} ${mo === 1 ? 'month' : 'months'} ago`;
  const y = Math.round(mo / 12);
  return `${y} ${y === 1 ? 'year' : 'years'} ago`;
}

/** Format a stored E.164 Indian number as "+91 98765 43210". */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}
