import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLayout } from './layout';
import { PathFinder } from './pathfinding';
import { assignHomes } from './seats';
import { FloorTemplateSchema, resolveTemplateId, TEMPLATE_IDS, templateFor, type FloorTemplate } from './template';

const DIR = join(__dirname, '../../../public/team-floor/templates');
const load = (id: string): FloorTemplate => FloorTemplateSchema.parse(JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8')));
const HOME_KINDS = new Set(['desk', 'hot_desk', 'reception', 'cabin']);

describe('floor templates (SPEC 12.1 item 4)', () => {
  it('picks Small up to 8 people, Medium up to 20, Large above, and keeps the override', () => {
    expect([1, 8, 9, 20, 21, 50].map(templateFor)).toEqual(['small', 'small', 'medium', 'medium', 'large', 'large']);
    expect(resolveTemplateId(30, 'small')).toBe('small');
  });

  for (const id of TEMPLATE_IDS) {
    describe(id, () => {
      const t = load(id);
      const layout = buildLayout(t, t.capacity);

      it('has one seat per person up to capacity (one person per desk)', () => {
        const homes = t.seats.filter((s) => HOME_KINDS.has(s.kind)).length;
        // Medium is the reference composition: 13 seats, the rest stand at spots around the floor.
        expect(homes).toBeGreaterThanOrEqual(id === 'medium' ? 13 : t.capacity);
        expect(layout.homes.length).toBeGreaterThanOrEqual(t.capacity);
      });

      it('gives every person a distinct home', () => {
        const people = Array.from({ length: t.capacity }, (_, i) => ({ id: `u${i}`, role: i === 0 ? ('manager' as const) : ('employee' as const), deskIndex: i }));
        const homes = assignHomes(people, layout);
        expect(new Set(homes).size).toBe(t.capacity);
      });

      it('can walk from the entrance to every seat and spot', () => {
        const paths = new PathFinder(layout);
        const { entrance } = layout;
        for (const h of [...layout.homes.slice(0, t.capacity), ...layout.booths, ...layout.lounge]) {
          const route = paths.route(entrance.x, entrance.z, h.x, h.z, { fromNode: entrance.approach, toNode: h.approach });
          expect(route, `route to ${h.id}`).not.toBeNull();
        }
      });

      if (id !== 'medium') {
        it('is composed from the module kit and every module seat exists', () => {
          expect(t.modules?.length).toBeGreaterThan(4);
          const kinds = new Set(t.modules?.map((m) => m.kind));
          for (const k of ['sales_pod', 'calling_room', 'manager_cabin', 'lounge', 'reception', 'hub_plaza', 'print_corner']) expect(kinds.has(k as never), k).toBe(true);
        });
      }
    });
  }

  it('Large has a bigger calling room and two lounges', () => {
    const large = load('large');
    const medium = load('medium');
    expect(large.seats.filter((s) => s.kind === 'booth').length).toBeGreaterThan(medium.seats.filter((s) => s.kind === 'booth').length);
    expect(large.rooms.filter((r) => r.type === 'lounge').length).toBe(2);
  });
});
