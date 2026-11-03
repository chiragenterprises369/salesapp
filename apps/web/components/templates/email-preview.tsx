'use client';

import { renderEmail, type EmailBrand, type EmailLayoutTheme, type EmailTemplateVariable, type TemplateValues } from '@vistar/shared';
import { useDeferredValue, useMemo, useState } from 'react';
import { Segmented } from '@/components/dashboard/segmented';
import { cn } from '@/lib/cn';

type View = 'html' | 'text';

/**
 * Live preview of an e-mail template with sample values, in the branded layout, light and dark side by
 * side. The HTML renders inside a sandboxed iframe (no scripts, no same-origin, no navigation), so even
 * unsaved markup cannot run; the plain-text part (what text-only clients show) is one click away.
 */
export function EmailPreview({
  subject,
  html,
  values,
  variables,
  brand,
  fromLine,
  className,
}: {
  subject: string;
  html: string;
  values: TemplateValues;
  variables: readonly EmailTemplateVariable[];
  brand: EmailBrand;
  /** "Vistar <no-reply@vistar.app>" (shown above the subject). */
  fromLine?: string;
  className?: string;
}) {
  const [view, setView] = useState<View>('html');
  // Typing stays smooth on long templates: the preview follows a frame behind.
  const deferredSubject = useDeferredValue(subject);
  const deferredHtml = useDeferredValue(html);
  const rendered = useMemo(
    () =>
      (['light', 'dark'] as const).map((theme) => ({
        theme,
        ...renderEmail({ subject: deferredSubject, html: deferredHtml }, values, { brand, variables, theme }),
      })),
    [deferredSubject, deferredHtml, values, brand, variables],
  );
  const first = rendered[0]!;

  return (
    <section aria-label="Preview with sample data" className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-fg">Preview</h3>
        <span className="text-xs text-muted-strong">Sample data</span>
        <Segmented
          label="Preview format"
          value={view}
          onChange={setView}
          options={[
            { value: 'html', label: 'HTML' },
            { value: 'text', label: 'Plain text' },
          ]}
          className="ml-auto"
        />
      </div>
      <dl className="grid gap-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
        {fromLine && (
          <div className="flex min-w-0 gap-2">
            <dt className="w-14 shrink-0 text-xs text-muted-strong">From</dt>
            <dd className="truncate text-fg-secondary">{fromLine}</dd>
          </div>
        )}
        <div className="flex min-w-0 gap-2">
          <dt className="w-14 shrink-0 text-xs text-muted-strong">Subject</dt>
          <dd className="min-w-0 font-medium break-words text-fg">{first.subject || <span className="text-muted-strong">No subject</span>}</dd>
        </div>
      </dl>
      {view === 'html' ? (
        <div className="grid gap-3 2xl:grid-cols-2">
          {rendered.map((r) => (
            <PreviewFrame key={r.theme} theme={r.theme} html={r.html} />
          ))}
        </div>
      ) : (
        <pre className="max-h-[480px] overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-xs whitespace-pre-wrap text-fg">{first.text}</pre>
      )}
    </section>
  );
}

function PreviewFrame({ theme, html }: { theme: EmailLayoutTheme; html: string }) {
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <figcaption className="text-xs font-medium text-fg-secondary">{theme === 'light' ? 'Light theme' : 'Dark theme'}</figcaption>
      <iframe
        title={`E-mail preview, ${theme} theme`}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={html}
        className="h-[460px] w-full rounded-md border border-border bg-surface"
      />
    </figure>
  );
}
