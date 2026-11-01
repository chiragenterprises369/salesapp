import { cn } from '@/lib/cn';

/**
 * Circular progress (targets). Over 100% fills the ring and shows the real percentage.
 * The visible label and the sr-only sentence carry the value; the SVG is decorative.
 */
export function ProgressRing({ value, size = 64, stroke = 6, label, className }: { value: number; size?: number; stroke?: number; label: string; className?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.round(value));
  const offset = c * (1 - Math.min(pct, 100) / 100);
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-3" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className={cn('transition-[stroke-dashoffset] duration-250 ease-standard', pct >= 100 ? 'stroke-success' : 'stroke-accent')}
        />
      </svg>
      <span aria-hidden className="absolute text-xs font-semibold text-fg tabular">
        {pct}%
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
