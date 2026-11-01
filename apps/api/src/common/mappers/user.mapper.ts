import type { AvatarConfig, RoleKind, UserSummary } from '@vistar/shared';

/** Minimal shape needed to build a UserSummary (select these fields + role.kind). */
export interface UserSummarySource {
  id: string;
  name: string;
  status: UserSummary['status'];
  avatar: unknown;
  role: { kind: RoleKind };
}

/** Prisma select for UserSummary. Usage: `include: { owner: { select: USER_SUMMARY_SELECT } }` */
export const USER_SUMMARY_SELECT = {
  id: true,
  name: true,
  status: true,
  avatar: true,
  role: { select: { kind: true } },
} as const;

export function toUserSummary(u: UserSummarySource): UserSummary;
export function toUserSummary(u: UserSummarySource | null | undefined): UserSummary | null;
export function toUserSummary(u: UserSummarySource | null | undefined): UserSummary | null {
  if (!u) return null;
  return { id: u.id, name: u.name, role: u.role.kind, status: u.status, avatar: (u.avatar as AvatarConfig | null) ?? null };
}

/** Date | null -> ISO string | null. */
export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
