// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { startedOnInnerControl } from './inner-control';

/**
 * Board card presses: the card itself has role="button", so only controls INSIDE it may stop a drag or the
 * lead drawer. Matching the card blocked every drag and card click on the Leads board.
 */
function card(role: 'button' | 'checkbox' = 'button') {
  const li = document.createElement('li');
  li.setAttribute('role', 'button'); // an outer element with a role must not count either
  const face = document.createElement('div');
  face.setAttribute('role', role);
  const name = document.createElement('span');
  name.textContent = 'Ritu Kulkarni';
  const pill = document.createElement('button');
  const icon = document.createElement('svg');
  pill.append(icon);
  const menuItem = document.createElement('div');
  menuItem.setAttribute('role', 'menuitem');
  face.append(name, pill, menuItem);
  li.append(face);
  document.body.append(li);
  return { face, name, pill, icon, menuItem };
}

describe('startedOnInnerControl', () => {
  it('lets a press on the card body start a drag (the card is role="button")', () => {
    const c = card();
    expect(startedOnInnerControl({ target: c.name, currentTarget: c.face })).toBe(false);
    expect(startedOnInnerControl({ target: c.face, currentTarget: c.face })).toBe(false);
  });

  it('ignores presses on controls inside the card', () => {
    const c = card();
    expect(startedOnInnerControl({ target: c.pill, currentTarget: c.face })).toBe(true);
    expect(startedOnInnerControl({ target: c.icon, currentTarget: c.face })).toBe(true);
    expect(startedOnInnerControl({ target: c.menuItem, currentTarget: c.face })).toBe(true);
  });

  it('works in select mode (role="checkbox") and with odd targets', () => {
    const c = card('checkbox');
    expect(startedOnInnerControl({ target: c.name, currentTarget: c.face })).toBe(false);
    expect(startedOnInnerControl({ target: c.pill, currentTarget: c.face })).toBe(true);
    expect(startedOnInnerControl({ target: null, currentTarget: c.face })).toBe(false);
    expect(startedOnInnerControl({ target: document.createTextNode('x'), currentTarget: c.face })).toBe(false);
  });
});
