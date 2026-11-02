import { localClock } from '@vistar/shared';

/** Digits of an E.164 number for wa.me (no plus sign); null when there is no usable number. */
export function whatsappDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

/** `https://wa.me/<digits>` (opens WhatsApp on the phone, WhatsApp Web or the desktop app). */
export function whatsappUrl(phone: string | null | undefined, text?: string): string | null {
  const digits = whatsappDigits(phone);
  if (!digits) return null;
  return text ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://wa.me/${digits}`;
}

/** `tel:` link for the phone the viewer uses (desktop softphone, or the phone through phone link apps). */
export function telUrl(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const clean = phone.replace(/[^\d+]/g, '');
  return clean.replace(/\D/g, '').length >= 10 ? `tel:${clean}` : null;
}

/** Start of the current day in the workspace timezone, as ISO (for "today" queries). */
export function zonedDayStartIso(timezone: string, now = Date.now()): string {
  const { minutes } = localClock(new Date(now), timezone);
  return new Date(now - minutes * 60_000 - (now % 60_000)).toISOString();
}
