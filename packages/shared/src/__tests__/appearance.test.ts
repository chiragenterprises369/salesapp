import { describe, expect, it } from 'vitest';
import { resolveBoardSkin, resolveCelebrations, resolveInterfaceStyle, resolveMotion, type DeviceCaps } from '../appearance.js';
import { BOARD_SKINS, CELEBRATION_INTENSITIES, INTERFACE_STYLES, MOTION_INTENSITIES } from '../enums.js';
import {
  DEFAULT_USER_SETTINGS,
  SETTING_KEYS,
  UserSettingsSchema,
  UserSettingsUpdateSchema,
  WorkspaceSchema,
  WorkspaceUpdateSchema,
} from '../schemas/workspace.js';

const desktop: DeviceCaps = { coarsePointer: false, smallScreen: false, lowEnd: false, reducedMotion: false };
const limited: Array<[string, DeviceCaps]> = [
  ['coarse pointer', { ...desktop, coarsePointer: true }],
  ['small screen', { ...desktop, smallScreen: true }],
  ['low-end device', { ...desktop, lowEnd: true }],
  ['reduced motion', { ...desktop, reducedMotion: true }],
];

describe('resolveInterfaceStyle', () => {
  it('user choice > workspace default > classic on a capable desktop', () => {
    expect(resolveInterfaceStyle('neon', 'depth', desktop)).toBe('neon');
    expect(resolveInterfaceStyle(null, 'depth', desktop)).toBe('depth');
    expect(resolveInterfaceStyle(undefined, undefined, desktop)).toBe('classic');
    expect(resolveInterfaceStyle(null, null, desktop)).toBe('classic');
  });

  it.each(limited)('falls back to classic with %s, whatever was chosen', (_label, caps) => {
    for (const user of [...INTERFACE_STYLES, null]) for (const ws of [...INTERFACE_STYLES, null]) expect(resolveInterfaceStyle(user, ws, caps)).toBe('classic');
  });
});

describe('resolveBoardSkin', () => {
  it('user choice > workspace default > depth on a capable desktop', () => {
    expect(resolveBoardSkin('neon', 'flat', desktop)).toBe('neon');
    expect(resolveBoardSkin('flat', 'neon', desktop)).toBe('flat');
    expect(resolveBoardSkin(null, 'neon', desktop)).toBe('neon');
    expect(resolveBoardSkin(null, null, desktop)).toBe('depth');
    expect(resolveBoardSkin(undefined, undefined, desktop)).toBe('depth');
  });

  it.each(limited)('neon becomes flat with %s; depth and flat stay', (_label, caps) => {
    expect(resolveBoardSkin('neon', 'depth', caps)).toBe('flat');
    expect(resolveBoardSkin(null, 'neon', caps)).toBe('flat');
    expect(resolveBoardSkin('depth', 'neon', caps)).toBe('depth');
    expect(resolveBoardSkin('flat', null, caps)).toBe('flat');
    expect(resolveBoardSkin(null, null, caps)).toBe('depth');
  });

  it('never returns neon on a limited device', () => {
    for (const [, caps] of limited) for (const user of [...BOARD_SKINS, null]) for (const ws of [...BOARD_SKINS, null]) expect(resolveBoardSkin(user, ws, caps)).not.toBe('neon');
  });
});

describe('resolveMotion', () => {
  it('uses the user choice, default full', () => {
    for (const m of MOTION_INTENSITIES) expect(resolveMotion(m, desktop)).toBe(m);
    expect(resolveMotion(null, desktop)).toBe('full');
    expect(resolveMotion(undefined, desktop)).toBe('full');
  });

  it('is off with reduced motion', () => {
    for (const m of [...MOTION_INTENSITIES, null]) expect(resolveMotion(m, { ...desktop, reducedMotion: true })).toBe('off');
  });

  it('mobile and low-end alone do not change motion', () => {
    expect(resolveMotion('full', { ...desktop, coarsePointer: true, smallScreen: true, lowEnd: true })).toBe('full');
  });
});

describe('resolveCelebrations', () => {
  it('null follows motion: full -> full, reduced -> subtle, off -> off', () => {
    expect(resolveCelebrations(null, 'full')).toBe('full');
    expect(resolveCelebrations(null, 'reduced')).toBe('subtle');
    expect(resolveCelebrations(null, 'off')).toBe('off');
    expect(resolveCelebrations(undefined, 'reduced')).toBe('subtle');
  });

  it('an explicit choice wins while motion is on', () => {
    for (const c of CELEBRATION_INTENSITIES) {
      expect(resolveCelebrations(c, 'full')).toBe(c);
      expect(resolveCelebrations(c, 'reduced')).toBe(c);
    }
  });

  it('reduced motion forces off (through the resolved motion)', () => {
    const motion = resolveMotion('full', { ...desktop, reducedMotion: true });
    for (const c of [...CELEBRATION_INTENSITIES, null]) expect(resolveCelebrations(c, motion)).toBe('off');
  });
});

describe('appearance settings contract (D-052)', () => {
  it('setting keys', () => {
    expect(SETTING_KEYS.user).toMatchObject({
      interfaceStyle: 'ui.interfaceStyle',
      motionIntensity: 'ui.motionIntensity',
      boardSkin: 'leads.boardSkin',
      celebrations: 'leads.celebrations',
    });
    expect(SETTING_KEYS.workspace).toMatchObject({ defaultInterfaceStyle: 'ui.defaultInterfaceStyle', defaultBoardSkin: 'leads.defaultBoardSkin' });
  });

  it('user defaults: follow workspace / motion, motion full', () => {
    expect(DEFAULT_USER_SETTINGS).toMatchObject({ interfaceStyle: null, motionIntensity: 'full', boardSkin: null, celebrations: null });
    expect(UserSettingsSchema.parse({ theme: {}, notifications: {} })).toEqual(DEFAULT_USER_SETTINGS);
  });

  it('user PATCH applies no defaults and accepts null to follow the default again', () => {
    expect(UserSettingsUpdateSchema.parse({ boardSkin: 'neon' })).toEqual({ boardSkin: 'neon' });
    expect(UserSettingsUpdateSchema.parse({})).toEqual({});
    expect(UserSettingsUpdateSchema.parse({ interfaceStyle: null, boardSkin: null, celebrations: null })).toEqual({ interfaceStyle: null, boardSkin: null, celebrations: null });
    expect(UserSettingsUpdateSchema.safeParse({ motionIntensity: null }).success).toBe(false);
    expect(UserSettingsUpdateSchema.safeParse({ boardSkin: 'glass' }).success).toBe(false);
    expect(UserSettingsUpdateSchema.safeParse({ celebrations: 'reduced' }).success).toBe(false);
  });

  it('workspace defaults are classic and depth; PATCH applies no defaults and rejects null', () => {
    const shape = WorkspaceSchema.shape;
    expect(shape.defaultInterfaceStyle.parse(undefined)).toBe('classic');
    expect(shape.defaultBoardSkin.parse(undefined)).toBe('depth');
    expect(WorkspaceUpdateSchema.parse({ name: 'Shakti' })).toEqual({ name: 'Shakti' });
    expect(WorkspaceUpdateSchema.parse({ defaultBoardSkin: 'flat', defaultInterfaceStyle: 'neon' })).toEqual({ defaultBoardSkin: 'flat', defaultInterfaceStyle: 'neon' });
    expect(WorkspaceUpdateSchema.safeParse({ defaultBoardSkin: null }).success).toBe(false);
    expect(WorkspaceUpdateSchema.safeParse({ defaultInterfaceStyle: 'aurora' }).success).toBe(false);
  });
});
