import { createHash } from 'node:crypto';

/**
 * Deterministic UUID (RFC 9562 version 8, "custom") from a stable key. Used where one fact must map
 * to one row no matter how often or in which order it arrives (idempotent inserts with
 * `skipDuplicates`): the call of a live phone call, the timeline entry of a call, a status history row.
 */
export function stableUuid(namespace: string, ...parts: Array<string | number>): string {
  const h = createHash('sha256').update([namespace, ...parts].join('\u0000')).digest();
  h[6] = (h[6]! & 0x0f) | 0x80; // version 8
  h[8] = (h[8]! & 0x3f) | 0x80; // variant 10xx
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
