import type { ComponentType } from 'react';
import type { WidgetSlot } from '@vistar/shared';

/**
 * PACK UI REGISTRY. Code-backed manifest items (navigation pages, dashboard widgets, reports)
 * reference a component id "<packKey>.<Name>". Register a lazy loader here: one line per component.
 * Unknown ids render "Not available yet" and never crash.
 * OWNER: orchestrator; frontend-app may add registration lines for pack UIs it builds.
 */
export interface PackComponentProps {
  packKey: string;
  /** Enabled modes of the pack in this workspace. */
  modes: readonly string[];
  /** Page slug (navigation pages) and the remaining path segments. */
  page?: string;
  params?: readonly string[];
  /** Widget slot (dashboard widgets). */
  slot?: WidgetSlot;
  title?: string;
}

export type PackComponentLoader = () => Promise<{ default: ComponentType<PackComponentProps> }>;

export const PACK_UI: Readonly<Record<string, PackComponentLoader>> = {
  // 'demo-suppliers.SuppliersPage': () => import('@/components/packs/demo/suppliers-page'),
};
