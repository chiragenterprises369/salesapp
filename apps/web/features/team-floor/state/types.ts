import type { AttentionItem, AvatarConfig, CallOutcome, ChipTone, DomainEvent, EmployeeStatus, RoleKind } from '@vistar/shared';
import type { TemplateId } from './template';

/** Rooms on the floor plan (3D and flat views share them). */
export type RoomId = 'sales' | 'calling' | 'cabin' | 'lounge' | 'hub';

/** Where an employee currently is. `gone` = offline, empty chair. */
export type FloorLocation =
  | { kind: 'desk' }
  | { kind: 'booth'; index: number }
  | { kind: 'lounge'; index: number }
  | { kind: 'gone' };

export interface FloorActivity {
  id: string;
  at: number;
  text: string;
  tone: ChipTone;
}

export interface FloorCall {
  callId: string;
  /** Epoch ms (server clock). */
  startedAt: number;
  leadName: string | null;
}

export interface FloorEmployee {
  id: string;
  name: string;
  role: RoleKind;
  avatar: AvatarConfig | null;
  /** Home slot index in the layout (desk, hot desk, reception, cabin, standing or overflow spot). */
  desk: number;
  status: EmployeeStatus;
  /** Epoch ms of the last status change; null when the snapshot does not say. */
  statusSince: number | null;
  currentLeadId: string | null;
  currentLeadName: string | null;
  activeCall: FloorCall | null;
  callsToday: number;
  avgTalkSec: number;
  /** Calls included in avgTalkSec (running average). */
  talkedCalls: number;
  targetPct: number | null;
  recent: FloorActivity[];
}

export interface WaitingLead {
  leadId: string;
  name: string;
  createdAt: number;
}

/** Short-lived visual reactions. `at` = local receive time (epoch ms). */
export type FloorEffect =
  | { id: string; kind: 'parcel_spawn'; at: number; leadId: string }
  | {
      id: string;
      kind: 'delivery';
      at: number;
      leadId: string;
      leadName: string;
      toUserId: string;
      /** Desk the parcel starts from on a reassignment; null = from the Lead Hub. */
      fromUserId: string | null;
    }
  | { id: string; kind: 'call_started'; at: number; userId: string }
  | { id: string; kind: 'call_outcome'; at: number; userId: string; outcome: CallOutcome | null; durationSec: number }
  | { id: string; kind: 'wave'; at: number; userId: string };

export type FloorEffectKind = FloorEffect['kind'];

export interface FloorLogEntry {
  seq: number;
  at: number;
  text: string;
}

export interface FloorState {
  employees: FloorEmployee[];
  /** userId -> index in `employees`. */
  index: Record<string, number>;
  /** Floor template the homes refer to. */
  templateId: TemplateId;
  /** Home slots in use (layout is built for at least this many people). */
  homeCount: number;
  /** Calling room booths and lounge seats (userId or null). Stable allocation. */
  booths: (string | null)[];
  lounge: (string | null)[];
  leadsWaiting: WaitingLead[];
  /** Waiting leads counted by the server but not listed in the snapshot. */
  leadsWaitingExtra: number;
  attention: AttentionItem[];
  effects: FloorEffect[];
  /** Human-readable change log for the aria-live summary. */
  log: FloorLogEntry[];
  logSeq: number;
}

export type FloorAction =
  | { kind: 'reset'; state: FloorState }
  | { kind: 'events'; events: DomainEvent[]; now: number }
  | { kind: 'prune'; now: number }
  | { kind: 'resolve'; id: string }
  | { kind: 'restore'; item: AttentionItem }
  | { kind: 'reassign'; leadId: string; leadName: string; fromUserId: string | null; toUserId: string; now: number };

export type QualityTier = 'high' | 'medium' | 'low';
export type FloorViewMode = '3d' | 'flat';
