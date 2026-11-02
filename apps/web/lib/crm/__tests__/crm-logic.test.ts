import type { DealBoard, DealListItem, Stage } from '@vistar/shared';
import { describe, expect, it } from 'vitest';
import { applyDealMove } from '../board-logic';
import { scopesForCrmEvent } from '../event-scopes';
import { uuid4 } from '../ids';
import { resolveVisibleColumns } from '../ui/table-prefs';

const stage = (id: string, type: Stage['type'], probability: number): Stage => ({ id, pipelineId: 'p', key: id, name: id, type, order: 0, color: null, probability });
const deal = (id: string, stageId: string, valueInr: number, position: string): DealListItem =>
  ({ id, title: id, valueInr, pipelineId: 'p', stageId, status: 'open', position, probability: 10, weightedValueInr: valueInr / 10, owner: null, account: null, contact: null, lead: null, expectedCloseAt: null, closedAt: null, lostReason: null, lineCount: 0, version: 1, createdAt: '', updatedAt: '' }) as DealListItem;

function board(): DealBoard {
  const a = deal('a', 's1', 1000, 'a0');
  const b = deal('b', 's1', 500, 'a1');
  return {
    pipeline: { id: 'p', key: 'deals', name: 'Deals', isDefault: true, packKey: null, stages: [stage('s1', 'open', 10), stage('s2', 'won', 100)] },
    columns: [
      { stage: stage('s1', 'open', 10), count: 2, totalValueInr: 1500, weightedValueInr: 150, deals: [a, b], nextCursor: null },
      { stage: stage('s2', 'won', 100), count: 0, totalValueInr: 0, weightedValueInr: 0, deals: [], nextCursor: null },
    ],
  };
}

describe('deal board moves', () => {
  it('moves a card across columns with counts, totals, status and probability', () => {
    const b = board();
    const next = applyDealMove(b, b.columns[0]!.deals[0]!, 's2');
    expect(next.columns[0]).toMatchObject({ count: 1, totalValueInr: 500 });
    expect(next.columns[1]!.count).toBe(1);
    expect(next.columns[1]!.totalValueInr).toBe(1000);
    expect(next.columns[1]!.deals[0]).toMatchObject({ id: 'a', stageId: 's2', status: 'won', probability: 100, weightedValueInr: 1000 });
  });

  it('reorders inside a column after the given neighbour', () => {
    const b = board();
    const next = applyDealMove(b, b.columns[0]!.deals[0]!, 's1', 'b');
    expect(next.columns[0]!.deals.map((d) => d.id)).toEqual(['b', 'a']);
    expect(next.columns[0]!.count).toBe(2);
    expect(next.columns[0]!.deals[1]!.position > next.columns[0]!.deals[0]!.position).toBe(true);
  });
});

describe('CRM realtime scopes', () => {
  it('maps event prefixes to cache scopes', () => {
    expect(scopesForCrmEvent('deal.moved')).toContain('deals');
    expect(scopesForCrmEvent('invoice.payment_recorded')).toEqual(expect.arrayContaining(['invoices', 'quotations']));
    expect(scopesForCrmEvent('catalog.changed')).toEqual(['products']);
    expect(scopesForCrmEvent('meeting.reminder')).toContain('calendar');
    expect(scopesForCrmEvent('lead.created')).toEqual([]);
  });
});

describe('column preferences', () => {
  const cols = [{ id: 'name', hideable: false }, { id: 'phone' }, { id: 'email' }, { id: 'created', defaultHidden: true }];
  it('uses the defaults until something is stored', () => {
    expect(resolveVisibleColumns(cols, null)).toEqual(['name', 'phone', 'email']);
  });
  it('keeps required columns, drops unknown ids and keeps the declared order', () => {
    expect(resolveVisibleColumns(cols, ['created', 'gone', 'phone'])).toEqual(['name', 'phone', 'created']);
  });
});

describe('ids', () => {
  it('makes RFC 4122 v4 uuids', () => {
    for (let i = 0; i < 20; i++) expect(uuid4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
