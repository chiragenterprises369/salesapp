'use client';

import { WEBHOOK_SECRET_GRACE_DEFAULT_HOURS, WEBHOOK_SECRET_GRACE_MAX_HOURS, type WebhookEndpoint } from '@vistar/shared';
import { useState } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { toast } from '@/components/ui/toast';
import { FormField } from '@/components/ui/input';
import { ConfirmDialog } from '@/lib/crm/ui/confirm-dialog';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { useWebhookMutations } from '@/lib/hub/webhooks';
import { formatDateTimeIn } from '@/lib/crm/format';
import type { ShownOnceSecret } from '@/lib/hub/ui/secret-once';
import { useMe } from '@/lib/session/session';

const GRACE_CHOICES = [0, 1, 24, 72].filter((h) => h <= WEBHOOK_SECRET_GRACE_MAX_HOURS);

/**
 * Rotate an endpoint's signing secret. The old secret keeps working for the chosen grace period
 * (inbound: still accepted; outbound: deliveries carry both signatures), so senders and receivers
 * can switch without dropped requests. The new secret is handed to `onSecret` to show once.
 */
export function RotateSecretDialog({ endpoint, onClose, onSecret }: { endpoint: WebhookEndpoint | null; onClose: () => void; onSecret: (s: ShownOnceSecret) => void }) {
  const me = useMe();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const m = useWebhookMutations();
  const [grace, setGrace] = useState(String(WEBHOOK_SECRET_GRACE_DEFAULT_HOURS));
  const inbound = endpoint?.direction === 'inbound';
  return (
    <ConfirmDialog
      open={!!endpoint}
      onOpenChange={(o) => !o && onClose()}
      title={`Rotate the secret of ${endpoint?.name ?? 'this endpoint'}?`}
      description={inbound ? 'Vistar makes a new secret. Update the sender before the old one stops working.' : 'Vistar makes a new signing secret. Update your receiver before the old one stops working.'}
      confirmLabel="Rotate secret"
      tone="primary"
      loading={m.rotate.isPending}
      onConfirm={() =>
        endpoint &&
        m.rotate.mutate(
          { id: endpoint.id, graceHours: Number(grace) },
          {
            onSuccess: (r) => {
              onClose();
              toast.success('Secret rotated');
              onSecret({
                title: 'New secret',
                label: endpoint.verification === 'token' ? 'Token' : 'Signing secret',
                value: r.secret,
                note: r.previousSecretExpiresAt ? `The old secret keeps working until ${formatDateTimeIn(r.previousSecretExpiresAt, tz)}.` : 'The old secret stopped working now.',
              });
            },
            onError: (e) => toast.error(formErrorMessage(e, 'The secret was not rotated. Try again.')),
          },
        )
      }
    >
      <FormField label="Keep the old secret working for" hint="During this time both secrets work.">
        <NativeSelect value={grace} onChange={(e) => setGrace(e.target.value)}>
          {GRACE_CHOICES.map((h) => (
            <option key={h} value={h}>
              {h === 0 ? 'No time (stop it now)' : h === 1 ? '1 hour' : `${h} hours`}
            </option>
          ))}
        </NativeSelect>
      </FormField>
    </ConfirmDialog>
  );
}
