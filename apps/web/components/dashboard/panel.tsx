'use client';

import { useId, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { useBrandPalette } from '@/lib/branding/use-brand-palette';
import { cn } from '@/lib/cn';

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
        <div data-slot="panel-head" className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 sm:pt-6 pb-2.5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold tracking-tight text-ink">
              {title}
            </h2>
            {description && (
              <p id={descId} className="text-xs font-medium text-faint mt-0.5">
                {description}
              </p>
            )}
          </div>
          {action}
        </div>
        <div className="min-h-0 flex-1 px-5 sm:px-6 pb-5 sm:pb-6">
          {children({ titleId, descId: description ? descId : undefined })}
        </div>
      </section>
    </Card>
  );
}

/** Theme colours for Recharts props (CSS variables cannot be used in every SVG attribute), with the company's brand and chart palette. */
export function useChartPalette() {
  return useBrandPalette();
}
