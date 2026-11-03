import { NAV_COMPANY } from '@vistar/shared';
import { describe, expect, it } from 'vitest';
import { withChange19Nav } from './nav-utils';

/** Written for change #20; not run in this wave (static checks only). */

const settingsChildren = () =>
  withChange19Nav(NAV_COMPANY)
    .flatMap((g) => g.items)
    .find((i) => i.id === 'settings')!
    .children!.map((c) => c.id);

describe('change #20 settings navigation', () => {
  it('puts Setup right after Workspace', () => {
    const ids = settingsChildren();
    expect(ids.indexOf('settings-setup')).toBe(ids.indexOf('settings-workspace') + 1);
  });

  it('replaces the old Templates page with e-mail and WhatsApp templates', () => {
    const ids = settingsChildren();
    expect(ids).not.toContain('settings-templates');
    expect(ids).toContain('settings-email-templates');
    expect(ids.indexOf('settings-whatsapp-templates')).toBe(ids.indexOf('settings-email-templates') + 1);
  });

  it('lists every item once', () => {
    const ids = settingsChildren();
    expect(new Set(ids).size).toBe(ids.length);
  });
});
