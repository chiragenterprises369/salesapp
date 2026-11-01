import type { CallOutcome, EmployeeStatus, LeadSource, LeadTemperature } from '../enums.js';
import type { DomainEvent, EventName, EventPayload } from '../events.js';
import type { Call } from '../schemas/call.js';
import type { TeamFloorSnapshot } from '../schemas/dashboard.js';
import type { LeadListItem } from '../schemas/lead.js';
import type { Pipeline } from '../schemas/pipeline.js';
import { DEFAULT_STAGES } from '../schemas/pipeline.js';
import type { Task } from '../schemas/task.js';
import type { UserSummary } from '../schemas/workspace.js';
import { CITIES, COMPANY_PREFIXES, COMPANY_SUFFIXES, EMPLOYEE_FIXTURES, FIRST_NAMES, LAST_NAMES, PRODUCTS, TAGS } from './india.js';

/**
 * Deterministic mock data for building UIs before APIs exist (Wave 1).
 * Same seed -> same data. Shapes match the shared zod schemas exactly.
 */

export type Rng = () => number;

/** mulberry32 PRNG. */
export function createRng(seed = 42): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)] as T;
export const int = (rng: Rng, min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;

/** Deterministic RFC 4122 v4-shaped UUID. */
export function mockUuid(rng: Rng): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(rng() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const MOCK_WORKSPACE_ID = '0190f5a0-0000-7000-8000-000000000001';
export const MOCK_PIPELINE_ID = '0190f5a0-0000-7000-8000-000000000002';

export function mockUsers(): UserSummary[] {
  return EMPLOYEE_FIXTURES.map((e, i) => ({
    id: `0190f5a0-0000-7000-8000-1000000000${String(i).padStart(2, '0')}`,
    name: e.name,
    role: e.role,
    status: e.status,
    avatar: e.avatar,
  }));
}

export function mockPipeline(): Pipeline {
  return {
    id: MOCK_PIPELINE_ID,
    name: 'Sales',
    isDefault: true,
    stages: DEFAULT_STAGES.map((s, i) => ({
      id: `0190f5a0-0000-7000-8000-2000000000${String(i).padStart(2, '0')}`,
      pipelineId: MOCK_PIPELINE_ID,
      key: s.key,
      name: s.name,
      type: s.type,
      order: i,
      color: null,
      probability: s.probability,
    })),
  };
}

const SOURCES_WEIGHTED: LeadSource[] = ['indiamart', 'indiamart', 'indiamart', 'indiamart', 'whatsapp', 'whatsapp', 'website', 'website', 'manual', 'webhook'];

/**
 * Valid fractional-indexing key for position i (same format as the `fractional-indexing` package
 * used by the API), so mock positions can be passed to generateKeyBetween().
 */
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const mockRank = (i: number) =>
  i < 62 ? `a${B62[i]}` : `b${B62[Math.floor(i / 62) % 62]}${B62[i % 62]}`;

export function mockLeads(count = 60, seed = 7, now = new Date('2026-11-01T10:00:00+05:30')): LeadListItem[] {
  const rng = createRng(seed);
  const users = mockUsers().filter((u) => u.role === 'employee' || u.role === 'manager');
  const stages = mockPipeline().stages;
  const perStage = new Map<string, number>();
  return Array.from({ length: count }, () => {
    const first = pick(rng, FIRST_NAMES);
    const last = pick(rng, LAST_NAMES);
    const { city } = pick(rng, CITIES);
    const product = pick(rng, PRODUCTS);
    const stage = pick(rng, stages);
    const idx = perStage.get(stage.id) ?? 0;
    perStage.set(stage.id, idx + 1);
    const score = int(rng, 5, 98);
    const temperature: LeadTemperature = score > 70 ? 'hot' : score > 40 ? 'warm' : 'cold';
    const created = new Date(now.getTime() - int(rng, 0, 60 * 24 * 30) * 60_000);
    const owner = rng() < 0.12 ? null : pick(rng, users);
    const phoneTail = String(int(rng, 0, 99_999_999)).padStart(8, '0');
    return {
      id: mockUuid(rng),
      name: `${first} ${last}`,
      companyName: `${pick(rng, COMPANY_PREFIXES)} ${pick(rng, COMPANY_SUFFIXES)}`,
      phone: `+91${pick(rng, ['9', '8', '7'])}${int(rng, 0, 9)}${phoneTail}`,
      email: rng() < 0.6 ? `${first.toLowerCase()}.${last.toLowerCase()}@example.in` : null,
      city,
      source: pick(rng, SOURCES_WEIGHTED),
      pipelineId: MOCK_PIPELINE_ID,
      stageId: stage.id,
      position: mockRank(idx),
      owner,
      valueInr: Math.round(int(rng, product.min, product.max) / 500) * 500,
      score,
      temperature,
      tags: rng() < 0.5 ? [pick(rng, TAGS)] : [],
      nextFollowUpAt: rng() < 0.6 ? new Date(now.getTime() + int(rng, -2 * 1440, 5 * 1440) * 60_000).toISOString() : null,
      lastActivityAt: new Date(created.getTime() + int(rng, 0, 600) * 60_000).toISOString(),
      version: 1,
      createdAt: created.toISOString(),
      updatedAt: created.toISOString(),
    } satisfies LeadListItem;
  });
}

export function mockTeamFloorSnapshot(now = new Date()): TeamFloorSnapshot {
  const rng = createRng(11);
  const users = mockUsers();
  const leads = mockLeads(20, 3, now);
  const employees = users.map((u, i) => ({
    user: u,
    status: u.status,
    deskIndex: i,
    currentLeadId: u.status === 'on_call' || u.status === 'busy' ? (leads[i]?.id ?? null) : null,
    currentLeadName: u.status === 'on_call' || u.status === 'busy' ? (leads[i]?.name ?? null) : null,
    activeCall:
      u.status === 'on_call'
        ? { callId: mockUuid(rng), startedAt: new Date(now.getTime() - int(rng, 20, 400) * 1000).toISOString(), leadName: leads[i]?.name ?? null }
        : null,
    callsToday: int(rng, 0, 38),
    avgTalkSec: int(rng, 60, 320),
    targetPct: int(rng, 20, 120),
  }));
  const count = (s: EmployeeStatus) => employees.filter((e) => e.status === s).length;
  return {
    kpis: {
      active: employees.filter((e) => e.status !== 'offline').length,
      onCall: count('on_call'),
      idle: count('idle'),
      busy: count('busy'),
      callsToday: employees.reduce((a, e) => a + e.callsToday, 0),
      leadsWaiting: 3,
    },
    employees,
    leadsWaiting: leads.slice(0, 3).map((l) => ({ leadId: l.id, name: l.name, createdAt: l.createdAt })),
    attention: [],
    generatedAt: now.toISOString(),
  };
}

/**
 * Client/server event simulator. Produces realistic DomainEvents (new leads, assignments,
 * calls starting/ending, status changes, overdue tasks). Used by Wave 1 UIs and by the
 * server simulator script (which also persists rows).
 */
export function createEventSimulator(opts: { workspaceId?: string; seed?: number; users?: UserSummary[] } = {}) {
  const rng = createRng(opts.seed ?? 99);
  const workspaceId = opts.workspaceId ?? MOCK_WORKSPACE_ID;
  const users = (opts.users ?? mockUsers()).filter((u) => u.role !== 'viewer');
  const status = new Map<string, EmployeeStatus>(users.map((u) => [u.id, u.status]));
  const activeCalls = new Map<string, Call>();
  const waiting: LeadListItem[] = [];
  let leadSeed = 1000;

  const envelope = <E extends EventName>(type: E, payload: EventPayload<E>, userId: string | null = null): DomainEvent<E> => ({
    id: mockUuid(rng),
    type,
    workspaceId,
    occurredAt: new Date().toISOString(),
    actor: { type: 'simulator', id: null, name: 'Simulator' },
    userId,
    payload,
  });

  const setStatus = (userId: string, next: EmployeeStatus, leadId: string | null, callId: string | null) => {
    const prev = status.get(userId) ?? null;
    status.set(userId, next);
    return envelope('employee.status_changed', { userId, status: next, previousStatus: prev, currentLeadId: leadId, callId, at: new Date().toISOString() });
  };

  /** Advance one tick; returns 0..n events. Call every ~1-3s. */
  function next(): DomainEvent[] {
    const out: DomainEvent[] = [];
    const roll = rng();
    const online = users.filter((u) => status.get(u.id) !== 'offline');

    if (roll < 0.22) {
      const [lead] = mockLeads(1, leadSeed++);
      if (lead) {
        const fresh = { ...lead, owner: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), stageId: mockPipeline().stages[0]!.id };
        waiting.push(fresh);
        out.push(envelope('lead.created', { lead: fresh }));
      }
    } else if (roll < 0.4 && waiting.length) {
      const lead = waiting.shift() as LeadListItem;
      const owner = pick(rng, online.length ? online : users);
      const assigned = { ...lead, owner, version: lead.version + 1 };
      out.push(envelope('lead.assigned', { lead: assigned, fromUserId: null, toUserId: owner.id, rule: 'round_robin' }));
    } else if (roll < 0.62) {
      const free = online.filter((u) => status.get(u.id) === 'idle' || status.get(u.id) === 'busy');
      if (free.length) {
        const u = pick(rng, free);
        const [lead] = mockLeads(1, int(rng, 1, 500));
        const call: Call = {
          id: mockUuid(rng),
          direction: rng() < 0.7 ? 'outbound' : 'inbound',
          status: 'in_progress',
          outcome: null,
          leadId: lead?.id ?? null,
          leadName: lead?.name ?? null,
          user: { ...u, status: 'on_call' },
          from: '+918000000000',
          to: lead?.phone ?? '+919999999999',
          startedAt: new Date().toISOString(),
          answeredAt: new Date().toISOString(),
          endedAt: null,
          durationSec: 0,
          hasRecording: false,
          notes: null,
          disposition: null,
          provider: 'mock',
        };
        activeCalls.set(u.id, call);
        out.push(envelope('call.started', { call }));
        out.push(setStatus(u.id, 'on_call', call.leadId, call.id));
      }
    } else if (roll < 0.82 && activeCalls.size) {
      const [userId, call] = pick(rng, [...activeCalls.entries()]);
      activeCalls.delete(userId);
      const outcome: CallOutcome = pick(rng, ['answered', 'answered', 'interested', 'missed', 'callback', 'not_interested']);
      const ended: Call = {
        ...call,
        status: outcome === 'missed' ? 'missed' : 'completed',
        outcome,
        endedAt: new Date().toISOString(),
        durationSec: outcome === 'missed' ? 0 : int(rng, 25, 420),
        hasRecording: outcome !== 'missed',
      };
      out.push(envelope('call.ended', { call: ended }));
      out.push(setStatus(userId, rng() < 0.5 ? 'busy' : 'idle', call.leadId, null));
    } else if (roll < 0.92) {
      const u = pick(rng, users);
      if (!activeCalls.has(u.id)) {
        const nextStatus: EmployeeStatus = pick(rng, ['idle', 'busy', 'busy', 'away', 'idle', 'offline']);
        out.push(setStatus(u.id, nextStatus, null, null));
      }
    } else {
      const u = pick(rng, users);
      const [lead] = mockLeads(1, int(rng, 1, 500));
      const task: Task = {
        id: mockUuid(rng),
        type: 'call',
        title: `Call back ${lead?.name ?? 'lead'}`,
        notes: null,
        status: 'open',
        priority: 'high',
        leadId: lead?.id ?? null,
        leadName: lead?.name ?? null,
        assignee: u,
        dueAt: new Date(Date.now() - 15 * 60_000).toISOString(),
        remindAt: null,
        snoozedUntil: null,
        completedAt: null,
        source: 'workflow',
        workflowRunId: null,
        createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
        updatedAt: new Date().toISOString(),
      };
      out.push(envelope('task.overdue', { task }, u.id));
    }
    return out;
  }

  return { next, status: () => new Map(status) };
}
