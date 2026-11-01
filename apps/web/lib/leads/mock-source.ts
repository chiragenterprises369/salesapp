import type { Board, LeadFilters, LeadListItem, LeadListQuery, LeadMove, Page } from '@vistar/shared';
import { mockLeads, mockPipeline } from '@vistar/shared/fixtures';
import { generateKeyBetween } from 'fractional-indexing';
import type { LeadsSource } from './data';

/**
 * In-memory leads backend for Wave 1 (mock). Applies the shared filters exactly like the API will.
 * Set `window.__vistarMockFailRate = 0.5` in devtools to exercise optimistic rollback.
 */
const pipeline = mockPipeline();
let leads: LeadListItem[] = mockLeads(240, 7);
const delay = (ms = 120 + Math.random() * 180) => new Promise((r) => setTimeout(r, ms));

function matches(l: LeadListItem, f: LeadFilters): boolean {
  if (f.q) {
    const q = f.q.toLowerCase();
    const hay = [l.name, l.companyName, l.phone, l.email, l.city].filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (f.source?.length && !f.source.includes(l.source)) return false;
  if (f.stageId?.length && !f.stageId.includes(l.stageId)) return false;
  if (f.ownerId?.length) {
    const ok = f.ownerId.some((o) => (o === 'unassigned' ? !l.owner : o === 'me' ? l.owner?.role === 'manager' : l.owner?.id === o));
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
    const filtered = leads.filter((l) => l.pipelineId === pipelineId && matches(l, filters));
    return {
      pipeline,
      columns: pipeline.stages.map((stage) => {
        const inStage = filtered.filter((l) => l.stageId === stage.id).sort((a, b) => (a.position < b.position ? -1 : 1));
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

  async move(leadId: string, move: LeadMove): Promise<LeadListItem> {
    await delay();
    maybeFail();
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) throw new Error('Lead not found');
    const column = leads.filter((l) => l.stageId === move.stageId && l.id !== leadId).sort((a, b) => (a.position < b.position ? -1 : 1));
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
    leads = leads.map((l) => (l.id === leadId ? saved : l));
    return saved;
  },
};
