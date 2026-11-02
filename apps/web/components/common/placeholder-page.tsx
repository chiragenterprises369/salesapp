'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { NavIcon } from '@/components/shell/nav-icon';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/lib/session/session';
import { EmptyState } from './empty-state';
import { PageHeader } from './page-header';

export interface PlaceholderAction {
  label: string;
  href: string;
  /** Shown only with ANY of these permissions; otherwise `fallback` (if given) is shown. */
  anyOf?: readonly string[];
}

/**
 * Page that exists in the navigation before its feature ships: title, one-line description and an
 * empty state with the next useful step. Guarded by the same permissions as its nav item.
 * Props are serialisable so server pages can render it (icon = lucide name from the nav map).
 */
export function PlaceholderPage({
  title,
  description,
  icon,
  anyOf,
  emptyTitle,
  emptyDescription,
  action,
  fallback,
  meta,
  children,
}: {
  title: string;
  description: string;
  icon: string;
  anyOf: readonly string[];
  emptyTitle: string;
  emptyDescription: string;
  action?: PlaceholderAction;
  fallback?: PlaceholderAction;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <RequirePermission anyOf={anyOf}>
      <div>
        <PageHeader title={title} description={description} meta={meta} />
        <EmptyState
          icon={<NavIcon name={icon} />}
          title={emptyTitle}
          description={emptyDescription}
          action={<NextAction action={action} fallback={fallback} />}
        />
        {children}
      </div>
    </RequirePermission>
  );
}

function NextAction({ action, fallback }: { action?: PlaceholderAction; fallback?: PlaceholderAction }) {
  const permissions = usePermissions();
  const allowed = (a?: PlaceholderAction) => !!a && (!a.anyOf || a.anyOf.some((p) => permissions.includes(p)));
  const chosen = allowed(action) ? action : allowed(fallback) ? fallback : undefined;
  if (!chosen) return null;
  return (
    <Button asChild variant="primary">
      <Link href={chosen.href}>{chosen.label}</Link>
    </Button>
  );
}
