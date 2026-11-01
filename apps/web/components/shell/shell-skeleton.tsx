import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

/**
 * Full-page placeholder while the session loads. Mirrors each shell's layout so nothing jumps when
 * the real shell renders.
 */
export function ShellSkeleton({ variant }: { variant: 'plain' | 'company' | 'employee' | 'super-admin' }) {
  const sidebar = variant === 'company' || variant === 'super-admin';
  return (
    <div className="flex h-dvh overflow-hidden" aria-busy="true">
      <span role="status" className="sr-only">
        Loading Vistar
      </span>
      {sidebar && (
        <div className={cn('hidden shrink-0 flex-col gap-3 border-r border-border bg-surface p-3 md:flex', variant === 'super-admin' ? 'w-14 lg:w-52' : 'w-14 lg:w-60')}>
          <Skeleton className="h-7 w-full" />
          <div className="mt-3 flex flex-col gap-2">
            {Array.from({ length: 9 }, (_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        </div>
      )}
      {variant === 'employee' && (
        <div className="hidden w-56 shrink-0 flex-col gap-2 border-r border-border bg-surface p-3 lg:flex">
          <Skeleton className="h-7 w-2/3" />
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {variant !== 'plain' && (
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
            <Skeleton className="h-8 w-40 md:w-80" />
            <span className="flex-1" />
            <Skeleton className="size-8 rounded-full" />
          </div>
        )}
        <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
        {variant === 'employee' && (
          <div className="grid h-14 shrink-0 grid-cols-5 gap-2 border-t border-border bg-surface px-2 lg:hidden">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="m-auto h-8 w-10" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
