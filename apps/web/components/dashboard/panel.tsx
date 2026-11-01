'use client';

import { palettes } from '@vistar/shared';
import { useId, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { useDocumentTheme } from '@/lib/use-document-theme';

/** Dashboard card with a title row. `labelledBy` id is passed to children for figure/aria wiring. */
export function Panel({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  children: (ids: { titleId: string; descId: string | undefined }) => ReactNode;
}) {
  const titleId = useId();
  const descId = useId();
  return (
    <Card className={cn('flex min-w-0 flex-col', className)}>
      <section aria-labelledby={titleId} className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold">
              {title}
            </h2>
            {description && (
              <p id={descId} className="text-xs text-muted">
                {description}
              </p>
            )}
          </div>
          {action}
        </div>
        <div className="min-h-0 flex-1 px-4 pb-4">
          {children({ titleId, descId: description ? descId : undefined })}
        </div>
      </section>
    </Card>
  );
}

/** Theme colours for Recharts props (CSS variables cannot be used in every SVG attribute). */
export function useChartPalette() {
  const theme = useDocumentTheme();
  return palettes[theme];
}
