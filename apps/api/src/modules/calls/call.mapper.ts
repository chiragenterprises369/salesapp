import type { Call, CustomFieldValues, FieldDefinition } from '@vistar/shared';
import { toUserSummary, USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { publicValues, visibleFor } from '../customization/custom-values.js';

export const CALL_INCLUDE = {
  user: { select: USER_SUMMARY_SELECT },
  lead: { select: { id: true, name: true, ownerId: true } },
} as const;

export type CallRow = Prisma.CallGetPayload<{ include: typeof CALL_INCLUDE }>;

/**
 * Call row -> CallSchema. `defs` + `roleKey` strip custom fields hidden for the reader; with
 * `roleKey === undefined` the values are made safe for broadcast (events).
 */
export function toCall(c: CallRow, defs: readonly FieldDefinition[] = [], roleKey?: string | null): Call {
  const values = (c.customFields ?? {}) as CustomFieldValues;
  return {
    id: c.id,
    direction: c.direction,
    status: c.status,
    outcome: c.outcome,
    leadId: c.leadId,
    leadName: c.lead?.name ?? null,
    user: toUserSummary(c.user),
    from: c.fromNumber,
    to: c.toNumber,
    startedAt: c.startedAt.toISOString(),
    answeredAt: c.answeredAt?.toISOString() ?? null,
    endedAt: c.endedAt?.toISOString() ?? null,
    durationSec: c.durationSec,
    hasRecording: Boolean(c.recordingKey || c.recordingFileId),
    notes: c.notes,
    disposition: c.disposition,
    provider: c.provider,
    customFields: roleKey === undefined ? publicValues(defs, values) : visibleFor(defs, values, roleKey),
    source: c.source,
    result: c.result,
    phone: c.phone,
    deviceCallId: c.deviceCallId,
    recordingFileId: c.recordingFileId,
  };
}
