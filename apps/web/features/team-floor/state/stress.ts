import type { AvatarConfig, EmployeeStatus, TeamFloorEmployee, TeamFloorSnapshot } from '@vistar/shared';
import { createRng, EMPLOYEE_FIXTURES, FIRST_NAMES, int, LAST_NAMES, mockUuid, pick } from '@vistar/shared/fixtures';

const STATUSES: EmployeeStatus[] = ['busy', 'busy', 'idle', 'idle', 'on_call', 'on_call', 'away', 'offline'];
const HAIR_STYLES: AvatarConfig['hairStyle'][] = ['short', 'long', 'bun', 'curly', 'bald'];

/**
 * Dev stress mode (?floorStress=200): pads the snapshot with deterministic synthetic employees.
 * Avatar colours are reused from the seed fixtures, never invented.
 */
export function withStressEmployees(snapshot: TeamFloorSnapshot, total: number): TeamFloorSnapshot {
  const target = Math.min(200, Math.max(snapshot.employees.length, Math.floor(total)));
  if (target <= snapshot.employees.length) return snapshot;
  const rng = createRng(2024);
  const avatars = EMPLOYEE_FIXTURES.map((e) => e.avatar);
  const now = Date.parse(snapshot.generatedAt) || 0;
  const start = snapshot.employees.reduce((m, e) => Math.max(m, e.deskIndex + 1), 0);
  const extra: TeamFloorEmployee[] = [];
  for (let i = 0; i < target - snapshot.employees.length; i++) {
    const status = pick(rng, STATUSES);
    const base = pick(rng, avatars);
    const avatar: AvatarConfig = {
      skinTone: pick(rng, avatars).skinTone,
      hairColor: base.hairColor,
      hairStyle: pick(rng, HAIR_STYLES),
      outfitColor: pick(rng, avatars).outfitColor,
    };
    const name = `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
    const onCall = status === 'on_call';
    extra.push({
      user: { id: mockUuid(rng), name, role: 'employee', status, avatar },
      status,
      deskIndex: start + i,
      currentLeadId: onCall || status === 'busy' ? mockUuid(rng) : null,
      currentLeadName: onCall || status === 'busy' ? `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}` : null,
      activeCall: onCall
        ? { callId: mockUuid(rng), startedAt: new Date(now - int(rng, 15, 420) * 1000).toISOString(), leadName: `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}` }
        : null,
      callsToday: int(rng, 0, 40),
      avgTalkSec: int(rng, 60, 320),
      targetPct: int(rng, 15, 125),
    });
  }
  const employees = [...snapshot.employees, ...extra];
  const count = (s: EmployeeStatus) => employees.filter((e) => e.status === s).length;
  return {
    ...snapshot,
    employees,
    kpis: {
      ...snapshot.kpis,
      active: employees.filter((e) => e.status !== 'offline').length,
      onCall: count('on_call'),
      idle: count('idle'),
      busy: count('busy'),
      callsToday: employees.reduce((a, e) => a + e.callsToday, 0),
    },
  };
}
