import {
  AvatarConfigSchema,
  BusinessHoursSchema,
  PERMISSIONS,
  PhoneSchema,
  type DataScope,
  type EmployeeStatus,
  type Permission,
  type Role,
  type RoleKind,
  type Team,
  type User,
} from '@vistar/shared';
import { iso } from '../../common/mappers/user.mapper.js';

const PERMISSION_SET = new Set<string>(PERMISSIONS);

/** Drop unknown/legacy permission strings so responses and tokens always match the contract. */
export function validPermissions(list: readonly string[]): Permission[] {
  return [...new Set(list.filter((p) => PERMISSION_SET.has(p)))] as Permission[];
}

/** Prisma select for UserSchema. */
export const USER_SELECT = {
  id: true,
  workspaceId: true,
  email: true,
  phone: true,
  title: true,
  name: true,
  status: true,
  avatar: true,
  roleId: true,
  teamId: true,
  isActive: true,
  workingHours: true,
  statusChangedAt: true,
  lastSeenAt: true,
  isFieldStaff: true,
  createdAt: true,
  role: { select: { kind: true, name: true } },
} as const;

export interface UserRow {
  id: string;
  workspaceId: string;
  email: string;
  phone: string | null;
  title: string | null;
  name: string;
  status: EmployeeStatus;
  avatar: unknown;
  roleId: string;
  teamId: string | null;
  isActive: boolean;
  workingHours: unknown;
  statusChangedAt: Date | null;
  lastSeenAt: Date | null;
  isFieldStaff: boolean;
  createdAt: Date;
  role: { kind: RoleKind; name: string };
}

export function toUser(u: UserRow): User {
  const avatar = AvatarConfigSchema.safeParse(u.avatar);
  const hours = u.workingHours === null || u.workingHours === undefined ? null : BusinessHoursSchema.safeParse(u.workingHours);
  return {
    id: u.id,
    name: u.name,
    role: u.role.kind,
    status: u.status,
    avatar: avatar.success ? avatar.data : null,
    workspaceId: u.workspaceId,
    email: u.email,
    phone: u.phone && PhoneSchema.safeParse(u.phone).success ? u.phone : null,
    title: u.title,
    roleId: u.roleId,
    roleName: u.role.name,
    teamId: u.teamId,
    isActive: u.isActive,
    workingHours: hours && hours.success ? hours.data : null,
    statusChangedAt: iso(u.statusChangedAt),
    lastSeenAt: iso(u.lastSeenAt),
    isFieldStaff: u.isFieldStaff,
    createdAt: u.createdAt.toISOString(),
  };
}

/** Prisma include for RoleSchema.memberCount (soft-deleted users are not members). */
export const ROLE_MEMBER_COUNT = { _count: { select: { users: { where: { deletedAt: null } } } } } as const;

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  kind: RoleKind;
  dataScope: DataScope;
  permissions: string[];
  isSystem: boolean;
  _count: { users: number };
}

export function toRole(r: RoleRow): Role {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    kind: r.kind,
    dataScope: r.dataScope,
    permissions: validPermissions(r.permissions),
    isSystem: r.isSystem,
    memberCount: r._count.users,
  };
}

export const TEAM_INCLUDE = { members: { where: { deletedAt: null }, select: { id: true }, orderBy: { name: 'asc' } } } as const;

export function toTeam(t: { id: string; name: string; managerId: string | null; members: Array<{ id: string }> }): Team {
  return { id: t.id, name: t.name, managerId: t.managerId, memberIds: t.members.map((m) => m.id) };
}
