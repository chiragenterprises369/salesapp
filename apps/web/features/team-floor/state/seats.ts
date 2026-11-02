import type { RoleKind } from '@vistar/shared';
import type { FloorLayout } from './layout';

/**
 * Home assignment (SPEC 12.1 item 4). Deterministic for a given roster:
 * - the manager cabin goes to the most senior person (company admin, then manager; lowest desk index),
 * - the reception goes to the first viewer (front-office role), if any,
 * - everyone else keeps their `deskIndex` desk when it exists and is free,
 * - then free desks, hot desks, the reception, standing spots and overflow spots in template order.
 */

export interface Rostered {
  id: string;
  role: RoleKind;
  deskIndex: number;
}

const SENIORITY: Partial<Record<RoleKind, number>> = { company_admin: 2, manager: 1 };

export function assignHomes(people: readonly Rostered[], layout: FloorLayout): number[] {
  const homes = layout.homes;
  const out = new Array<number>(people.length).fill(-1);
  const used = new Set<number>();
  const firstOf = (kind: string) => homes.findIndex((h) => h.kind === kind);
  const byDesk = people.map((p, i) => ({ p, i })).sort((a, b) => a.p.deskIndex - b.p.deskIndex || a.p.id.localeCompare(b.p.id));

  const cabin = firstOf('cabin');
  if (cabin !== -1) {
    let best: { i: number; rank: number } | null = null;
    for (const { p, i } of byDesk) {
      const rank = SENIORITY[p.role] ?? 0;
      if (rank > 0 && (!best || rank > best.rank)) best = { i, rank };
    }
    if (best) {
      out[best.i] = cabin;
      used.add(cabin);
    }
  }
  const reception = firstOf('reception');
  if (reception !== -1) {
    const viewer = byDesk.find(({ p, i }) => p.role === 'viewer' && out[i] === -1);
    if (viewer) {
      out[viewer.i] = reception;
      used.add(reception);
    }
  }

  // deskIndex -> desk seat when it exists and is free.
  const desks = homes.map((h, i) => ({ h, i })).filter(({ h }) => h.kind === 'desk');
  for (const { p, i } of byDesk) {
    if (out[i] !== -1) continue;
    const desk = desks[p.deskIndex];
    if (desk && !used.has(desk.i)) {
      out[i] = desk.i;
      used.add(desk.i);
    }
  }
  // Everyone else: next free home in order (desks, hot desks, reception, cabin, standing, overflow).
  let cursor = 0;
  for (const { i } of byDesk) {
    if (out[i] !== -1) continue;
    while (cursor < homes.length && (used.has(cursor) || homes[cursor]!.kind === 'cabin')) cursor++;
    const slot = cursor < homes.length ? cursor : homes.length - 1;
    out[i] = slot;
    used.add(slot);
  }
  return out;
}
