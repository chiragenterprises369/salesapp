import { describe, expect, it } from 'vitest';
import { mockMe } from '../../lib/session/mock';
import { reportSummary } from '../../lib/world/read';
import { viewerFromMe } from '../../lib/world/scope';
import { worldContext } from '../../lib/world/world';
import { csvCell, toCsv } from './csv';
import { presetRange, previousRange } from './date-range';
import { callDayTotals, change, forecastByStage, reportKpis, slaShares, sortReps, successRate } from './logic';

const NOW = Date.now();
const r30 = presetRange('30d', NOW);
const admin = viewerFromMe(mockMe('company_admin'));
const manager = viewerFromMe(mockMe('manager'));
const employee = viewerFromMe(mockMe('employee'));
const viewer = viewerFromMe(mockMe('viewer'));
const all = reportSummary(r30.from, r30.to, admin);
const team = reportSummary(r30.from, r30.to, manager);

describe('report scope (through lib/world)', () => {
  it('managers get their team only; employees only themselves; viewers see the workspace', () => {
    expect(team.reps.length).toBeGreaterThan(1);
    expect(team.reps.every((r) => manager.visible!.has(r.user.id))).toBe(true);
    expect(reportSummary(r30.from, r30.to, employee).reps.map((r) => r.user.id)).toEqual([employee.userId]);
    expect(reportSummary(r30.from, r30.to, viewer).reps.length).toBe(all.reps.length);
    expect(reportKpis(team).leads).toBeLessThan(reportKpis(all).leads);
  });
});

describe('report aggregations', () => {
  it('KPIs add up the tables', () => {
    const k = reportKpis(all);
    expect(k.leads).toBe(all.sources.reduce((a, s) => a + s.leads, 0));
    expect(k.leads).toBe(all.funnel[0]!.count);
    expect(k.wonDeals).toBe(all.reps.reduce((a, r) => a + r.won, 0));
    expect(k.revenueInr).toBe(all.reps.reduce((a, r) => a + r.revenueInr, 0));
    expect(k.calls).toBe(all.callsByDay.reduce((a, d) => a + d.answered + d.missed, 0));
    expect(k.conversionPct).toBeGreaterThan(0);
    expect(k.conversionPct).toBeLessThan(100);
    expect(k.avgResponseMin).not.toBeNull();
  });

  it('SLA shares always add up to 100 and keep the counts', () => {
    const shares = slaShares(all.responseSla);
    expect(shares.reduce((a, s) => a + s.pct, 0)).toBe(100);
    expect(shares.reduce((a, s) => a + s.count, 0)).toBe(all.sources.reduce((a, s) => a + s.leads, 0));
    expect(slaShares({ within5Min: 1, within30Min: 1, later: 1, untouched: 0 }).map((s) => s.pct)).toEqual([34, 33, 33, 0]);
    expect(slaShares({ within5Min: 0, within30Min: 0, later: 0, untouched: 0 }).every((s) => s.pct === 0)).toBe(true);
  });

  it('forecast by stage matches the summary forecast and respects scope', () => {
    const ctx = worldContext();
    const rows = forecastByStage(ctx.leads, ctx.stages, null);
    expect(rows.map((r) => r.name)).toEqual(['New', 'Contacted', 'Interested', 'Quote sent']);
    expect(Math.abs(rows.reduce((a, r) => a + r.weightedInr, 0) - all.forecastInr)).toBeLessThanOrEqual(rows.length);
    const teamRows = forecastByStage(ctx.leads, ctx.stages, manager.visible);
    expect(Math.abs(teamRows.reduce((a, r) => a + r.weightedInr, 0) - team.forecastInr)).toBeLessThanOrEqual(rows.length);
    expect(teamRows.reduce((a, r) => a + r.leads, 0)).toBeLessThan(rows.reduce((a, r) => a + r.leads, 0));
  });

  it('comparisons, success rate, sorting and call day totals', () => {
    expect(change(120, 100)).toBe(20);
    expect(change(5, 0)).toBeNull();
    expect(change(5, null)).toBeNull();
    expect(previousRange({ from: 10, to: 20 })).toEqual({ from: 0, to: 10 });
    expect(successRate({ runs: 10, completed: 9, failed: 1 })).toBe(90);
    expect(successRate({ runs: 3, completed: 0, failed: 0 })).toBeNull();
    const byName = sortReps(all.reps, 'name', 'asc').map((r) => r.user.name);
    expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b)));
    const byRevenue = sortReps(all.reps, 'revenueInr', 'desc');
    for (let i = 1; i < byRevenue.length; i++) expect(byRevenue[i - 1]!.revenueInr).toBeGreaterThanOrEqual(byRevenue[i]!.revenueInr);
    const t = callDayTotals(all.callsByDay);
    expect(t.total).toBe(t.answered + t.missed);
    expect(t.busiest).not.toBeNull();
  });
});

describe('CSV export', () => {
  it('escapes quotes, commas and new lines, and blocks formulas', () => {
    expect(csvCell('Shakti, Pune')).toBe('"Shakti, Pune"');
    expect(csvCell('He said "ok"')).toBe('"He said ""ok"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+91 98100')).toBe("'+91 98100");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
    expect(toCsv(['a', 'b'], [[1, 'x'], [2, null]])).toBe('a,b\r\n1,x\r\n2,');
  });
});
