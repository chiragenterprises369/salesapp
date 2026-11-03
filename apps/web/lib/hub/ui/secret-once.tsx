'use client';

import { KeyRound, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { CheckboxRow } from '@/components/settings/common/checkbox';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CopyField } from './copy';

export interface ShownOnceSecret {
  /** Dialog title, e.g. "API key created". */
  title: string;
  /** Label of the value ("API key", "Signing secret"). */
  label: string;
  value: string;
  /** Extra lines under the value (grace period of the old key, where to paste it). */
  note?: ReactNode;
  /** More content below (example curl). */
  extra?: ReactNode;
}

/**
 * The plaintext secret or key, shown exactly once. Closing needs an explicit "I have stored it" tick,
 * and clicking outside does not close it (an accidental click would lose the secret for good).
 */
export function SecretOnceDialog({ secret, onClose }: { secret: ShownOnceSecret | null; onClose: () => void }) {
  const [stored, setStored] = useState(false);
  const close = () => {
    setStored(false);
    onClose();
  };
  return (
    <Dialog open={!!secret} onOpenChange={(o) => !o && stored && close()}>
      <DialogContent size="lg" hideClose onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => !stored && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound aria-hidden className="size-4" />
            {secret?.title}
          </DialogTitle>
          <DialogDescription>Copy it now and keep it somewhere safe, such as your server&apos;s environment settings or a password manager.</DialogDescription>
        </DialogHeader>
        {secret && (
          <DialogBody className="flex flex-col gap-4">
            <CopyField label={secret.label} value={secret.value} what={secret.label} testId="secret-once-value" />
            <div className="flex items-start gap-2 rounded-md border border-status-amber-border bg-status-amber-bg px-3 py-2.5 text-sm text-status-amber-fg">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <p>Vistar shows this only once and stores only a fingerprint of it. If you lose it, rotate it to get a new one.</p>
            </div>
            {secret.note && <div className="text-sm text-fg-secondary">{secret.note}</div>}
            {secret.extra}
            <CheckboxRow checked={stored} onCheckedChange={setStored} label="I have copied and stored it" />
          </DialogBody>
        )}
        <DialogFooter>
          <Button variant="primary" disabled={!stored} onClick={close}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
