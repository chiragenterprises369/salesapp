import { describe, expect, it } from 'vitest';
import { linkTarget } from './links';

const O = 'http://localhost:3003';
const LEAD = '0190f5a0-1111-7000-8000-000000000001';

describe('linkTarget (links stay on the floor)', () => {
  it('opens module panels for module pages of the same panel', () => {
    expect(linkTarget('/app/tasks', 'company', O)?.module).toBe('tasks');
    expect(linkTarget('/app/calls?userId=x', 'company', O)?.module).toBe('calls');
    expect(linkTarget('/app/inbox?c=abc', 'company', O)).toMatchObject({ module: 'inbox' });
    expect(linkTarget('/app/inbox?c=abc', 'company', O)?.search.get('c')).toBe('abc');
    expect(linkTarget('/app', 'company', O)?.module).toBe('dashboard');
    expect(linkTarget('/me', 'employee', O)?.module).toBe('today');
    expect(linkTarget('/me/leads', 'employee', O)?.module).toBe('leads');
  });

  it('opens the lead drawer for ?lead= links and keeps Leads filters', () => {
    expect(linkTarget(`/app/leads?lead=${LEAD}`, 'company', O)).toMatchObject({ module: null, leadId: LEAD });
    const t = linkTarget('/app/leads?ownerId=unassigned&temperature=hot&view=table', 'company', O);
    expect(t?.module).toBe('leads');
    expect(t?.search.get('ownerId')).toBe('unassigned');
  });

  it('leaves full lead pages, other pages, other panels and other origins alone', () => {
    expect(linkTarget(`/app/leads/${LEAD}`, 'company', O)).toBeNull();
    expect(linkTarget('/app/settings/branding', 'company', O)).toBeNull();
    expect(linkTarget('/me/tasks', 'company', O)).toBeNull();
    expect(linkTarget('https://example.com/app/tasks', 'company', O)).toBeNull();
    expect(linkTarget('mailto:a@b.c', 'company', O)).toBeNull();
  });
});
