import type { z } from 'zod';

/**
 * First issue per top-level field. `messages` replaces zod's generic wording with copy that says how
 * to fix the value ("Enter a valid email, like priya@company.in").
 */
export function fieldErrors<K extends string>(error: z.ZodError, messages: Partial<Record<K, string>> = {}): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '') as K;
    if (key && !(key in out)) out[key] = messages[key] ?? issue.message;
  }
  return out;
}

/** Move focus to the first invalid control so keyboard and screen-reader users land on the problem. */
export function focusFirstInvalid(form: HTMLFormElement | null) {
  requestAnimationFrame(() => form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}
