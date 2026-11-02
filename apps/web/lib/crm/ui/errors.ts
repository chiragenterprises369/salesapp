import { isApiRequestError } from '@/lib/api-error';

/** Server field errors keyed by their path ("phone", "billingAddress.stateCode", "lines.0.gstRate"). */
export function serverFieldErrors(e: unknown): Record<string, string> {
  if (!isApiRequestError(e)) return {};
  return Object.fromEntries(e.details.filter((d) => !d.path.startsWith('customFields.') && !d.path.startsWith('values.')).map((d) => [d.path, d.message]));
}

/** Message for a form banner: the server's own message, or a connection hint. */
export function formErrorMessage(e: unknown, fallback = 'Changes were not saved. Check your connection and try again.'): string {
  if (!isApiRequestError(e)) return fallback;
  if (e.code === 'VERSION_CONFLICT') return 'Someone else changed this record while you were editing. Close the form, reload and try again.';
  if (e.code === 'VALIDATION_FAILED' && e.details.length) return e.details.length === 1 ? 'Fix the highlighted field to save.' : `Fix the ${e.details.length} highlighted fields to save.`;
  return e.message;
}

/** Errors of one nested object ("billingAddress.city" -> { city }). */
export function nestedErrors(errors: Record<string, string>, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) if (k.startsWith(`${prefix}.`)) out[k.slice(prefix.length + 1)] = v;
  return out;
}

/** Focus the first invalid control in a form after a failed submit. */
export function focusFirstInvalid(formId: string): void {
  requestAnimationFrame(() => {
    const el = document.getElementById(formId)?.querySelector<HTMLElement>('[aria-invalid="true"]');
    el?.focus();
  });
}
