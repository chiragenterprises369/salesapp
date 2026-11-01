import { cn } from '@/lib/cn';

/** Vistar mark: indigo tile with an upward "V" (expansion). Decorative; pair with a visible or sr-only name. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-7 shrink-0', className)}>
      <rect width="32" height="32" rx="8" className="fill-accent" />
      <path d="M9 10.5 16 22l7-11.5" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="stroke-accent-fg" />
      <circle cx="23" cy="10.5" r="2" className="fill-accent-fg" />
    </svg>
  );
}

export function Logo({ className, label = 'Vistar' }: { className?: string; label?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="text-base font-semibold tracking-tight text-fg">{label}</span>
    </span>
  );
}
