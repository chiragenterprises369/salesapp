import type {
  Board,
  BulkResult,
  CustomFieldValues,
  Lead,
  LeadBulkAction,
  LeadCreate,
  LeadFilters,
  LeadListItem,
  LeadListQuery,
  LeadMove,
  LeadUpdate,
  Page,
} from '@vistar/shared';
import { validateCustomValues, visibleValues } from '@vistar/shared';
import { mockLeads, mockUsers } from '@vistar/shared/fixtures';
import { ApiRequestError } from '../api-error';
import { readMockDb } from '../mock-db';
import { generateKeyBetween } from 'fractional-indexing';
import { useSessionStore } from '../session/session';
import type { LeadsSource } from './data';

/**
 * In-memory leads backend for Wave 1 (mock). Applies the shared filters AND the signed-in mock
 * persona's data scope (own / team / all) exactly like the API will.
 * Set `window.__vistarMockFailRate = 0.5` in devtools to exercise optimistic rollback.
 */
const users = mockUsers();
let leads: LeadListItem[] = mockLeads(240, 7);
const extra = new Map<string, Partial<Lead>>();
const delay = (ms = 120 + Math.random() * 180) => new Promise((r) => setTimeout(r, ms));

/** Default pipeline from the shared mock DB, so stage edits in Settings show on the Board. */
function currentPipeline() {
  const db = readMockDb();
  const p = db.state.pipelines.find((x) => x.isDefault && !x.archived) ?? db.state.pipelines[0]!;
  const stages = p.stages
    .filter((s) => !s.archived)
    .sort((a, b) => a.order - b.order)
    .map((s, order) => ({ id: s.id, pipelineId: p.id, key: s.key, name: s.name, type: s.type, order, color: s.color, probability: s.probability }));
  return { id: p.id, key: p.key, name: p.name, isDefault: p.isDefault, packKey: p.packKey, stages };
}

/** Leads per stage id (all leads, ignoring data scope), for the stage editor's delete guard. */
export function mockLeadCountByStage(): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of leads) m.set(l.stageId, (m.get(l.stageId) ?? 0) + 1);
  return m;
}

function viewer(): { userId: string | null; visible: string[] | null } {
  const s = useSessionStore.getState().session;
  if (!s || s.audience !== 'workspace') return { userId: null, visible: null };
  const { me } = s;
  if (me.role.dataScope === 'all') return { userId: me.user.id, visible: null };
  if (me.role.dataScope === 'own') return { userId: me.user.id, visible: [me.user.id] };
  return { userId: me.user.id, visible: [...new Set([me.user.id, ...me.teamMemberIds])] };
}

function inScope(l: LeadListItem): boolean {
  const { visible } = viewer();
  return visible === null || (l.owner !== null && visible.includes(l.owner.id));
}

function matches(l: LeadListItem, f: LeadFilters): boolean {
  if (!inScope(l)) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    const hay = [l.name, l.companyName, l.phone, l.email, l.city].filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (f.source?.length && !f.source.includes(l.source)) return false;
  if (f.stageId?.length && !f.stageId.includes(l.stageId)) return false;
  if (f.ownerId?.length) {
    const me = viewer().userId;
    const ok = f.ownerId.some((o) => (o === 'unassigned' ? !l.owner : o === 'me' ? l.owner?.id === me : l.owner?.id === o));
    if (!ok) return false;
  }
  if (f.tag?.length && !f.tag.some((t) => l.tags.includes(t))) return false;
  if (f.temperature?.length && !f.temperature.includes(l.temperature)) return false;
  if (f.scoreMin !== undefined && l.score < f.scoreMin) return false;
  if (f.scoreMax !== undefined && l.score > f.scoreMax) return false;
  if (f.createdFrom && l.createdAt < f.createdFrom) return false;
  if (f.createdTo && l.createdAt > f.createdTo) return false;
  return true;
}

function maybeFail() {
  const rate = typeof window !== 'undefined' ? ((window as unknown as { __vistarMockFailRate?: number }).__vistarMockFailRate ?? 0) : 0;
  if (Math.random() < rate) throw new Error('Mock failure');
}

const byPosition = (a: LeadListItem, b: LeadListItem) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0);

function stageLeads(pipelineId: string, stageId: string, filters: LeadFilters) {
  return leads.filter((l) => l.pipelineId === pipelineId && l.stageId === stageId && matches(l, filters)).sort(byPosition);
}

/** Lead custom fields from the shared mock DB (field target "lead"). */
function leadFieldDefs() {
  const db = readMockDb();
  return db.state.fields
    .filter((f) => f.target === 'lead')
    .map((f) => ({ key: f.key, label: f.label, type: f.type, config: f.config, required: f.required, access: f.access, archivedAt: f.archived ? (db.meta[f.id]?.archivedAt ?? 'archived') : null }));
}

/** Validate like the API (VALIDATION_FAILED with field paths "customFields.<key>"). */
function validLeadCustomFields(values: Record<string, unknown>, mode: 'create' | 'update'): CustomFieldValues {
  const s = useSessionStore.getState().session;
  const roleKey = s?.audience === 'workspace' ? s.me.role.key : null;
  const r = validateCustomValues(leadFieldDefs(), values, { mode, roleKey });
  if (!r.ok) throw new ApiRequestError('VALIDATION_FAILED', r.errors[0]!.message, r.errors);
  return r.values;
}

function toLead(l: LeadListItem): Lead {
  const stage = currentPipeline().stages.find((s) => s.id === l.stageId);
  const s = useSessionStore.getState().session;
  const roleKey = s?.audience === 'workspace' ? s.me.role.key : null;
  const more = extra.get(l.id);
  return {
    ...l,
    contactId: null,
    companyId: null,
    state: null,
    productInterest: null,
    requirement: 'Please share best price with GST and delivery time.',
    sourceRef: l.source === 'indiamart' ? `IM-${l.id.slice(0, 6)}` : null,
    scoreBreakdown: [
      { rule: 'Source: IndiaMART', points: l.source === 'indiamart' ? 15 : 5 },
      { rule: 'Deal value above ₹1L', points: l.valueInr > 100_000 ? 20 : 0 },
      { rule: 'Replied on WhatsApp', points: l.score > 50 ? 25 : 0 },
    ],
    stageType: stage?.type ?? 'open',
    whatsappOptIn: l.source === 'whatsapp' ? true : null,
    dnd: false,
    mergedIntoId: null,
    ...more,
    customFields: visibleValues(leadFieldDefs(), more?.customFields ?? {}, roleKey),
  };
}

function findOrThrow(id: string): LeadListItem {
  const lead = leads.find((l) => l.id === id);
  if (!lead || !inScope(lead)) throw new Error('Lead not found');
  return lead;
}

function topPosition(stageId: string): string {
  const col = leads.filter((l) => l.stageId === stageId).sort(byPosition);
  return generateKeyBetween(null, col[0]?.position ?? null);
}

function endPosition(stageId: string): string {
  const col = leads.filter((l) => l.stageId === stageId).sort(byPosition);
  return generateKeyBetween(col.at(-1)?.position ?? null, null);
}

function replace(next: LeadListItem) {
  leads = leads.map((l) => (l.id === next.id ? next : l));
}

export const mockLeadsSource: LeadsSource = {
  async list(query: LeadListQuery): Promise<Page<LeadListItem>> {
    await delay();
    const { sort = 'createdAt', dir = 'desc', limit = 50, cursor } = query;
    const rows = leads
      .filter((l) => matches(l, query))
      .sort((a, b) => {
        const av = a[sort] ?? '';
        const bv = b[sort] ?? '';
        const c = av < bv ? -1 : av > bv ? 1 : 0;
        return dir === 'asc' ? c : -c;
      });
    const start = cursor ? Number(cursor) : 0;
    const items = rows.slice(start, start + limit);
    const next = start + limit < rows.length ? String(start + limit) : null;
    return { items, nextCursor: next, total: rows.length };
  },

  async board(pipelineId: string, filters: LeadFilters, perColumn = 50): Promise<Board> {
    await delay();
    const pipeline = currentPipeline();
    return {
      pipeline,
      columns: pipeline.stages.map((stage) => {
        const inStage = stageLeads(pipelineId, stage.id, filters);
        return {
          stage,
          count: inStage.length,
          totalValueInr: inStage.reduce((sum, l) => sum + l.valueInr, 0),
          leads: inStage.slice(0, perColumn),
          nextCursor: inStage.length > perColumn ? String(perColumn) : null,
        };
      }),
    };
  },

  async columnPage(pipelineId, stageId, filters, cursor, limit = 50) {
    await delay();
    const inStage = stageLeads(pipelineId, stageId, filters);
    const start = Number(cursor) || 0;
    return { items: inStage.slice(start, start + limit), nextCursor: start + limit < inStage.length ? String(start + limit) : null, total: inStage.length };
  },

  async get(id) {
    await delay(80);
    return toLead(findOrThrow(id));
  },

  async create(input: LeadCreate) {
    await delay();
    maybeFail();
    const now = new Date().toISOString();
    const stageId = input.stageId ?? currentPipeline().stages[0]!.id;
    const owner = input.ownerId ? (users.find((u) => u.id === input.ownerId) ?? null) : (users.find((u) => u.id === viewer().userId) ?? null);
    const item: LeadListItem = {
      id: crypto.randomUUID(),
      name: input.name,
      companyName: input.companyName ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      city: input.city ?? null,
      source: input.source,
      pipelineId: currentPipeline().id,
      stageId,
      position: topPosition(stageId),
      owner,
      valueInr: input.valueInr,
      score: 30,
      temperature: 'warm',
      tags: input.tags,
      nextFollowUpAt: null,
      lastActivityAt: now,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    leads = [item, ...leads];
    extra.set(item.id, { productInterest: input.productInterest ?? null, requirement: input.requirement ?? null, state: input.state ?? null, customFields: validLeadCustomFields(input.customFields ?? {}, 'create') });
    return toLead(item);
  },

  async update(id, patch: LeadUpdate) {
    await delay();
    maybeFail();
    const lead = findOrThrow(id);
    if (patch.expectedVersion !== undefined && patch.expectedVersion !== lead.version) throw new Error('VERSION_CONFLICT');
    const owner = patch.ownerId === undefined ? lead.owner : patch.ownerId === null ? null : (users.find((u) => u.id === patch.ownerId) ?? lead.owner);
    const stageId = patch.stageId ?? lead.stageId;
    if (patch.customFields !== undefined) {
      const prev = extra.get(id) ?? {};
      const merged = { ...(prev.customFields ?? {}), ...validLeadCustomFields(patch.customFields, 'update') };
      extra.set(id, { ...prev, customFields: merged });
    }
    const next: LeadListItem = {
      ...lead,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.companyName !== undefined ? { companyName: patch.companyName } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      ...(patch.email !== undefined ? { email: patch.email } : {}),
      ...(patch.city !== undefined ? { city: patch.city } : {}),
      ...(patch.valueInr !== undefined ? { valueInr: patch.valueInr } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.nextFollowUpAt !== undefined ? { nextFollowUpAt: patch.nextFollowUpAt } : {}),
      owner,
      stageId,
      position: stageId !== lead.stageId ? endPosition(stageId) : lead.position,
      version: lead.version + 1,
      updatedAt: new Date().toISOString(),
    };
    replace(next);
    return toLead(next);
  },

  async bulk(action: LeadBulkAction): Promise<BulkResult> {
    await delay(300);
    maybeFail();
    const failed: BulkResult['failed'] = [];
    let succeeded = 0;
    for (const id of action.leadIds) {
      const lead = leads.find((l) => l.id === id);
      if (!lead || !inScope(lead)) {
        failed.push({ id, code: 'NOT_FOUND', message: 'Lead not found' });
        continue;
      }
      switch (action.action) {
        case 'assign':
          replace({ ...lead, owner: action.ownerId ? (users.find((u) => u.id === action.ownerId) ?? null) : null, version: lead.version + 1 });
          break;
        case 'change_stage':
          replace({ ...lead, stageId: action.stageId, position: endPosition(action.stageId), version: lead.version + 1 });
          break;
        case 'add_tags':
          replace({ ...lead, tags: [...new Set([...lead.tags, ...action.tags])], version: lead.version + 1 });
          break;
        case 'remove_tags':
          replace({ ...lead, tags: lead.tags.filter((t) => !action.tags.includes(t)), version: lead.version + 1 });
          break;
        case 'delete':
          leads = leads.filter((l) => l.id !== id);
          break;
        case 'whatsapp_template':
          if (!lead.phone) {
            failed.push({ id, code: 'CONSENT_MISSING', message: 'No phone number' });
            continue;
          }
          break;
      }
      succeeded++;
    }
    return { succeeded, failed };
  },

  async move(leadId: string, move: LeadMove): Promise<LeadListItem> {
    await delay();
    maybeFail();
    const lead = findOrThrow(leadId);
    const column = leads.filter((l) => l.stageId === move.stageId && l.id !== leadId).sort(byPosition);
    const before = move.beforeLeadId ? column.find((l) => l.id === move.beforeLeadId) : undefined;
    const after = move.afterLeadId ? column.find((l) => l.id === move.afterLeadId) : undefined;
    let lower: string | null;
    let upper: string | null;
    if (before) {
      lower = before.position;
      upper = column[column.indexOf(before) + 1]?.position ?? null;
    } else if (after) {
      lower = column[column.indexOf(after) - 1]?.position ?? null;
      upper = after.position;
    } else {
      // No neighbours = end of column (LeadMoveSchema).
      lower = column.at(-1)?.position ?? null;
      upper = null;
    }
    const position = generateKeyBetween(lower, upper);
    const saved: LeadListItem = { ...lead, stageId: move.stageId, position, version: lead.version + 1, updatedAt: new Date().toISOString() };
    replace(saved);
    return saved;
  },
};
