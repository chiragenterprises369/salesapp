'use client';

import { objectTarget, visibleFields, type CustomObject } from '@vistar/shared';
import { mockUsers } from '@vistar/shared/fixtures';
import {
  Box,
  Briefcase,
  Building2,
  CalendarCheck,
  Car,
  ClipboardList,
  Factory,
  FileText,
  GraduationCap,
  Hammer,
  House,
  MapPin,
  Package,
  Stethoscope,
  Store,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { createElement, useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { useMe } from '@/lib/session/session';
import type { FieldDef } from '../field-utils';

/** Lucide icons a custom object can use (CustomObject.icon). Unknown names fall back to Box. */
const OBJECT_ICONS: Record<string, LucideIcon> = {
  Box,
  Briefcase,
  Building2,
  CalendarCheck,
  Car,
  ClipboardList,
  Factory,
  FileText,
  GraduationCap,
  Hammer,
  House,
  MapPin,
  Package,
  Stethoscope,
  Store,
  Truck,
  Users,
  Warehouse,
};

export function ObjectIcon({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  return createElement(OBJECT_ICONS[name ?? ''] ?? Box, {
    'aria-hidden': true,
    className: cn('size-4 shrink-0', className),
  });
}

export const USERS = mockUsers();
export const USER_BY_ID = new Map(USERS.map((u) => [u.id, u]));

/** Fields of an object the signed-in role may see, in display order. */
export function useObjectFields(object: CustomObject | undefined): FieldDef[] {
  const me = useMe();
  if (!object) return [];
  return visibleFields(object.fields, objectTarget(object.key), me?.role.key);
}

/** Debounced copy of a value (search boxes that query the server). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export const isNotFound = (e: unknown) =>
  typeof e === 'object' &&
  e !== null &&
  'code' in e &&
  (e as { code: string }).code === 'NOT_FOUND';
