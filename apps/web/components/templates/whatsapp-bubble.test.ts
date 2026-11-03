import { describe, expect, it } from 'vitest';
import { maxVariableIndex } from './whatsapp-bubble';

/** Written for change #20; not run in this wave (static checks only). */

describe('WhatsApp variables', () => {
  it('finds the highest numbered variable across header and body', () => {
    expect(maxVariableIndex('Hi {{1}}', 'Your order {{2}} ships on {{ 3 }}')).toBe(3);
    expect(maxVariableIndex(null, 'No variables')).toBe(0);
    expect(maxVariableIndex('{{10}} and {{2}}')).toBe(10);
  });
});
