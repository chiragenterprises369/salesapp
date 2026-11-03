'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';

/** Copy to the clipboard with a toast; falls back to a hint when the browser blocks it (http on a LAN). */
export async function copyText(text: string, what: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
    return true;
  } catch {
    toast.error('Copy did not work in this browser. Select the text and copy it.');
    return false;
  }
}

/** Copy button whose icon turns into a tick for 2 s (the toast announces it to screen readers). */
export function CopyButton({ text, what, label, size = 'sm', variant = 'secondary', className }: { text: string; what: string; label?: string; size?: 'sm' | 'md' | 'icon-sm'; variant?: 'secondary' | 'ghost'; className?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const onClick = async () => {
    if (await copyText(text, what)) {
      setDone(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 2000);
    }
  };
  const icon = done ? <Check aria-hidden /> : <Copy aria-hidden />;
  if (size === 'icon-sm')
    return (
      <Button size="icon-sm" variant={variant} aria-label={label ?? `Copy ${what.toLowerCase()}`} onClick={() => void onClick()} className={className}>
        {icon}
      </Button>
    );
  return (
    <Button size={size} variant={variant} onClick={() => void onClick()} className={className}>
      {icon}
      {label ?? 'Copy'}
    </Button>
  );
}

/** Read-only value (URL, token) with a label and a copy button. The text is selectable. */
export function CopyField({ label, value, what, hint, mono = true, testId }: { label: ReactNode; value: string; what: string; hint?: ReactNode; mono?: boolean; testId?: string }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex min-w-0 items-center gap-2">
        <input
          id={id}
          readOnly
          value={value}
          data-testid={testId}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onFocus={(e) => e.currentTarget.select()}
          className={cn(
            'h-8 w-full min-w-0 rounded-md border border-input bg-surface-2 px-2.5 text-sm text-fg shadow-card focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
            mono && 'font-mono text-xs',
          )}
        />
        <CopyButton text={value} what={what} />
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Code sample with a heading and a copy button; scrolls sideways instead of wrapping. */
export function CodeBlock({ title, code, what, language }: { title: string; code: string; what: string; language?: string }) {
  const id = useId();
  return (
    <figure className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface-2">
      <figcaption className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span id={id} className="text-xs font-medium text-fg-secondary">
          {title}
          {language && <span className="ml-1.5 text-muted-strong">{language}</span>}
        </span>
        <CopyButton text={code} what={what} size="sm" variant="ghost" />
      </figcaption>
      <pre tabIndex={0} aria-labelledby={id} className="focus-ring max-h-80 overflow-auto px-3 py-2.5 font-mono text-xs leading-5 text-fg">
        <code>{code}</code>
      </pre>
    </figure>
  );
}
