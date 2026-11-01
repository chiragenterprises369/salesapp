'use client';

import { AlertCircle, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { EmptyState } from './empty-state';

export interface DataColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  /** Hide below this width to avoid sideways scrolling on phones. */
  hideBelow?: 'sm' | 'md' | 'lg';
}

const hide = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' } as const;

export function columnClass(col: DataColumn) {
  return cn(col.align === 'right' && 'text-right', col.hideBelow && hide[col.hideBelow]);
}

/**
 * Dense table card with the three list states built in: loading (skeleton rows matching the columns),
 * error (message + retry) and empty (what to do next). Rows are passed as children.
 */
export function DataTable({
  label,
  columns,
  status,
  onRetry,
  empty,
  toolbar,
  children,
  skeletonRows = 6,
  className,
}: {
  label: string;
  columns: readonly DataColumn[];
  status: 'loading' | 'error' | 'empty' | 'ready';
  onRetry?: () => void;
  empty: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode };
  toolbar?: ReactNode;
  children?: ReactNode;
  skeletonRows?: number;
  className?: string;
}) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      {toolbar && <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">{toolbar}</div>}
      <Table aria-label={label} aria-busy={status === 'loading' || undefined}>
        <TableHeader>
          <TableRow className="hover:bg-surface">
            {columns.map((c) => (
              <TableHead key={c.key} className={columnClass(c)}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {status === 'loading' &&
            Array.from({ length: skeletonRows }, (_, r) => (
              <TableRow key={r} className="hover:bg-surface">
                {columns.map((c, i) => (
                  <TableCell key={c.key} className={columnClass(c)}>
                    <Skeleton className={cn('h-3.5', i === 0 ? 'w-36' : 'w-16', c.align === 'right' && 'ml-auto')} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          {status === 'ready' && children}
          {(status === 'empty' || status === 'error') && (
            <TableRow className="hover:bg-surface">
              <TableCell colSpan={columns.length} className="h-auto p-3 whitespace-normal">
                {status === 'error' ? (
                  <EmptyState
                    size="sm"
                    className="border-none"
                    icon={<AlertCircle />}
                    title="This list did not load"
                    description="Check your connection, then try again."
                    action={
                      onRetry && (
                        <Button onClick={onRetry}>
                          <RotateCw aria-hidden />
                          Try again
                        </Button>
                      )
                    }
                  />
                ) : (
                  <EmptyState size="sm" className="border-none" icon={empty.icon} title={empty.title} description={empty.description} action={empty.action} />
                )}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
