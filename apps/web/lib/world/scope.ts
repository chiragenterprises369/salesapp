import type { DataScope, MeResponse, RoleKind } from '@vistar/shared';
import { useSessionStore } from '../session/session';

/**
 * Who is reading world data, and what they may see. Same rules as the Leads mock source and the
 * API's ScopeService: `own` = records owned by / assigned to the user, `team` = the user plus the
 * members of the teams they manage, `all` = the whole workspace. Unassigned records are visible only
 * with `all`. During a read-only support session without content access, message bodies are hidden.
 */
export interface Viewer {
  userId: string | null;
  kind: RoleKind | null;
  dataScope: DataScope;
  /** User ids in scope; null = everyone. */
  visible: ReadonlySet<string> | null;
  permissions: readonly string[];
  /** Message bodies and recordings are hidden (impersonation without content access). */
  contentHidden: boolean;
}

const NOBODY: Viewer = { userId: null, kind: null, dataScope: 'own', visible: new Set(), permissions: [], contentHidden: true };

export function viewerFromMe(me: MeResponse | null | undefined): Viewer {
  if (!me) return NOBODY;
  const scope = me.role.dataScope;
  const visible = scope === 'all' ? null : scope === 'own' ? new Set([me.user.id]) : new Set([me.user.id, ...me.teamMemberIds]);
  return {
    userId: me.user.id,
    kind: me.role.kind,
    dataScope: scope,
    visible,
    permissions: me.permissions,
    contentHidden: !!me.impersonation && !me.impersonation.contentAccess,
  };
}

/** Viewer from the signed-in mock session (data sources call this, like lib/leads/mock-source). */
export function currentViewer(): Viewer {
  const s = useSessionStore.getState().session;
  return s?.audience === 'workspace' ? viewerFromMe(s.me) : NOBODY;
}

/** Is a record owned by / assigned to `ownerId` visible to the viewer? */
export const canSee = (v: Viewer, ownerId: string | null | undefined) => v.visible === null || (!!ownerId && v.visible.has(ownerId));

export const can = (v: Viewer, permission: string) => v.permissions.includes(permission);
