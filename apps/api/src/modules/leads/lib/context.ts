import type { Logger } from '@nestjs/common';
import type { AuditActorType, EventActor, EventName, EventPayload, Permission, UserSummary } from '@vistar/shared';
import type { AuthContext } from '../../../common/auth/auth-context.js';
import { AppException } from '../../../common/errors/app-exception.js';
import { toUserSummary, USER_SUMMARY_SELECT } from '../../../common/mappers/user.mapper.js';
import type { EventBus } from '../../../infra/events/event-bus.service.js';
import type { TenantPrisma } from '../../../infra/prisma/tenant.js';

/** Tenant client or an interactive-transaction client created from it (same model delegates). */
export type TenantDb = Omit<TenantPrisma, '$transaction' | '$connect' | '$disconnect' | '$on' | '$extends' | '$use'>;

export const can = (auth: AuthContext, permission: Permission): boolean => auth.permissions.includes(permission);

export function requirePermission(auth: AuthContext, permission: Permission, message = 'You do not have permission to do this'): void {
  if (!can(auth, permission)) throw new AppException('FORBIDDEN', message);
}

/** Who performed a write, in the shapes events, activities and payloads need. */
export interface RequestActor {
  event: EventActor;
  summary: UserSummary | null;
  activityActorType: AuditActorType;
  activityActorId: string | null;
}

const actorCache = new WeakMap<AuthContext, Promise<RequestActor>>();

export function requestActor(db: TenantDb, auth: AuthContext): Promise<RequestActor> {
  let pending = actorCache.get(auth);
  if (!pending) {
    pending = (async (): Promise<RequestActor> => {
      const user = auth.userId ? await db.user.findUnique({ where: { id: auth.userId }, select: USER_SUMMARY_SELECT }) : null;
      const summary = toUserSummary(user);
      if (auth.via === 'api_key') {
        return { event: { type: 'api_key', id: auth.apiKeyId, name: null }, summary, activityActorType: 'api_key', activityActorId: auth.userId };
      }
      return {
        event: { type: 'user', id: auth.userId, name: summary?.name ?? null },
        summary,
        activityActorType: auth.impersonation ? 'super_admin' : 'user',
        activityActorId: auth.userId,
      };
    })();
    actorCache.set(auth, pending);
  }
  return pending;
}

export const SYSTEM_ACTOR: EventActor = { type: 'system', id: null, name: 'Vistar' };

/**
 * Publish after commit without failing the request: the write already happened, so a bus or contract
 * error is logged (event type and issue paths only, never payload values) instead of turning into a 500.
 */
export async function publishSafe<E extends EventName>(
  events: EventBus,
  logger: Logger,
  type: E,
  workspaceId: string,
  payload: EventPayload<E>,
  opts: { actor?: EventActor | null; userId?: string | null } = {},
): Promise<void> {
  try {
    await events.publish(type, workspaceId, payload, opts);
  } catch (err) {
    const issues = (err as { issues?: Array<{ path: PropertyKey[] }> }).issues;
    const where = issues ? ` at ${issues.map((i) => i.path.join('.')).join(', ')}` : '';
    logger.error(`Event ${type} not published: ${(err as Error).name}${where}`);
  }
}

/** Panel prefix for deep links addressed to a user (employees use /me, everyone else /app). */
export const panelPrefix = (kind: string | null | undefined): string => (kind === 'employee' ? '/me' : '/app');
