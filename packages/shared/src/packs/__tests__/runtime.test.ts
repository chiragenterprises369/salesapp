import { describe, expect, it } from 'vitest';
import { NAV_COMPANY, NAV_EMPLOYEE_MORE, withNavLabels, withObjectNavigation, withPackEmployeeNavigation, withPackNavigation, labelNavItem } from '../../navigation.js';
import { resolveLabels } from '../../customization/labels.js';
import { buildPackRuntime, isEntitled, packEntitlement, runtimeForPermissions } from '../runtime.js';
import { HOMES_V1 } from './fixtures.js';

describe('buildPackRuntime', () => {
  it('collects runtime items for the enabled modes', () => {
    const dev = buildPackRuntime({ packs: [{ manifest: HOMES_V1, modes: ['developer'] }] });
    expect(dev.packs).toEqual([{ key: 'test-homes', version: '1.0.0', modes: ['developer'] }]);
    expect(dev.navigation.map((n) => n.id)).toEqual(['inventory']);
    expect(dev.widgets.map((w) => `${w.packKey}:${w.key}`)).toEqual(['test-homes:visits_today']);
    expect(dev.mapLayers).toHaveLength(1);

    const broker = buildPackRuntime({ packs: [{ manifest: HOMES_V1, modes: ['broker'] }] });
    expect(broker.navigation).toEqual([]);
    expect(broker.mapLayers).toEqual([]);
    expect(broker.widgets).toHaveLength(1);
  });

  it('resolves labels from the stored overrides', () => {
    const rt = buildPackRuntime({ packs: [], labelOverrides: { lead: { singular: 'Enquiry', plural: 'Enquiries' } } });
    expect(rt.labels.lead.plural).toBe('Enquiries');
    expect(rt.labels.task.plural).toBe('Tasks');
  });

  it('drops items the caller may not see', () => {
    const rt = buildPackRuntime({ packs: [{ manifest: { ...HOMES_V1, navigation: [{ ...HOMES_V1.navigation[0]!, anyOf: ['settings.manage'] }] }, modes: ['developer'] }] });
    expect(runtimeForPermissions(rt, ['leads.read']).navigation).toEqual([]);
    expect(runtimeForPermissions(rt, ['settings.manage']).navigation).toHaveLength(1);
  });
});

describe('packEntitlement', () => {
  it('core > override > plan', () => {
    expect(packEntitlement({ core: true, plan: 'free', plans: [], override: 'revoke' })).toBe('core');
    expect(packEntitlement({ core: false, plan: 'growth', plans: ['growth'], override: 'revoke' })).toBe('revoked');
    expect(packEntitlement({ core: false, plan: 'free', plans: ['growth'], override: 'grant' })).toBe('grant');
    expect(packEntitlement({ core: false, plan: 'growth', plans: ['growth'], override: null })).toBe('plan');
    expect(packEntitlement({ core: false, plan: 'free', plans: ['growth'], override: null })).toBe('none');
    expect(['core', 'plan', 'grant'].every((e) => isEntitled(e as never))).toBe(true);
    expect(isEntitled('revoked')).toBe(false);
  });
});

describe('navigation extension points', () => {
  it('applies configurable labels to nav items', () => {
    const labels = resolveLabels({ lead: { singular: 'Enquiry', plural: 'Enquiries' }, task: { singular: 'Follow-up', plural: 'Follow-ups' } });
    const work = withNavLabels(NAV_COMPANY, labels).find((g) => g.id === 'work')!;
    expect(work.items.find((i) => i.id === 'leads')!.label).toBe('Enquiries');
    expect(work.items.find((i) => i.id === 'tasks')!.label).toBe('Follow-ups');
    expect(labelNavItem(NAV_EMPLOYEE_MORE.find((i) => i.id === 'tasks')!, labels).label).toBe('Follow-ups and reminders');
  });

  it('adds custom objects after Leads and pack pages to their group', () => {
    const withObjects = withObjectNavigation(NAV_COMPANY, [{ key: 'supplier', labelSingular: 'Supplier', labelPlural: 'Suppliers', icon: 'Truck', showInNav: true, packKey: null }]);
    const ids = withObjects.find((g) => g.id === 'work')!.items.map((i) => i.id);
    expect(ids.indexOf('object-supplier')).toBe(ids.indexOf('leads') + 1);

    const rt = buildPackRuntime({ packs: [{ manifest: HOMES_V1, modes: ['developer'] }] });
    const item = withPackNavigation(NAV_COMPANY, rt.navigation).find((g) => g.id === 'work')!.items.at(-1)!;
    expect(item).toMatchObject({ id: 'pack-test-homes-inventory', href: '/app/x/test-homes/inventory' });
    expect(withPackEmployeeNavigation(NAV_EMPLOYEE_MORE, rt.navigation)).toHaveLength(NAV_EMPLOYEE_MORE.length);
  });
});
