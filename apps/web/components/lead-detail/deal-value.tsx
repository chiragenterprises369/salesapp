'use client';

import { formatInr, InrSchema } from '@vistar/shared';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Deal value with inline edit (Enter saves, Esc cancels). Whole rupees. */
export function DealValue({
  value,
  editable,
  onSave,
}: {
  value: number;
  editable: boolean;
  onSave: (v: number) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const parsed = InrSchema.safeParse(Number(draft.replace(/[₹,\s]/g, '')));
    if (!draft.trim() || !parsed.success) return setError('Enter whole rupees, up to ₹200 crore');
    if (parsed.data === value) return setEditing(false);
    setSaving(true);
    try {
      await onSave(parsed.data);
      setEditing(false);
    } catch {
      setError('Not saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-1">
        <span className="tabular text-lg font-semibold">{formatInr(value)}</span>
        {editable && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Edit deal value"
            onClick={() => {
              setDraft(String(value));
              setError(null);
              setEditing(true);
            }}
          >
            <Pencil aria-hidden />
          </Button>
        )}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          data-esc-local
          inputMode="numeric"
          aria-label="Deal value in rupees"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'deal-value-error' : undefined}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setEditing(false);
            }
          }}
          className="tabular w-32"
        />
        <Button size="sm" type="submit" loading={saving}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      {error && (
        <p id="deal-value-error" role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      )}
    </form>
  );
}
