import { Loader2 } from 'lucide-react';

/** Shown for the moment between a successful sign-in and the redirect to the panel. */
export function SigningIn({ label = 'Opening your workspace' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface p-6 text-sm text-fg-secondary shadow-card">
      <Loader2 aria-hidden className="size-4 animate-spin" />
      {label}
    </div>
  );
}
