import type { FieldType } from '@vistar/shared';
import { Calendar, CircleDot, Hash, IndianRupee, Link, Link2, ListChecks, MapPin, Paperclip, ToggleLeft, Type, UserRound, type LucideIcon } from 'lucide-react';
import { createElement } from 'react';
import { cn } from '@/lib/cn';

export const FIELD_TYPE_ICONS: Record<FieldType, LucideIcon> = {
  text: Type,
  number: Hash,
  money: IndianRupee,
  date: Calendar,
  select: CircleDot,
  multi_select: ListChecks,
  user: UserRound,
  relation: Link2,
  file: Paperclip,
  geo_point: MapPin,
  boolean: ToggleLeft,
  url: Link,
};

export const FIELD_TYPE_HINTS: Record<FieldType, string> = {
  text: 'Names, codes, short notes',
  number: 'Quantities and counts',
  money: 'Amounts in whole rupees',
  date: 'A date, with or without time',
  select: 'Pick one from a list',
  multi_select: 'Pick several from a list',
  user: 'Someone on your team',
  relation: 'Link to a lead, deal or record',
  file: 'Documents and photos',
  geo_point: 'A place on the map',
  boolean: 'A yes or no answer',
  url: 'A web address',
};

export function FieldTypeIcon({ type, className }: { type: FieldType; className?: string }) {
  return createElement(FIELD_TYPE_ICONS[type], { 'aria-hidden': true, className: cn('size-4 shrink-0', className) });
}
