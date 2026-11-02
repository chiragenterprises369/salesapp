import { normalizeIndianPhone } from '@vistar/shared';

/**
 * Normalise a number read from the phone's call log to E.164 (pure).
 * - Indian mobiles in any common shape (98765 43210, 098765..., +91-98765..., 91 98765...) -> +91XXXXXXXXXX
 * - `+` or `00` international prefixes -> +<digits>
 * - Indian landlines with the trunk 0 (020 2612 3456) -> +91 without the 0
 * - Anything else (short codes, hidden numbers, "Unknown") -> null: the call is kept without a lead match.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const indian = normalizeIndianPhone(trimmed);
  if (indian) return indian;
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return valid(`+${digits}`);
  if (digits.startsWith('00')) return valid(`+${digits.slice(2)}`);
  // Indian landline: trunk prefix 0 + STD code + number = 11 digits.
  if (digits.length === 11 && digits.startsWith('0') && digits[1] !== '0') return valid(`+91${digits.slice(1)}`);
  return null;
}

function valid(e164: string): string | null {
  return /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : null;
}
