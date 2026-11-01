'use client';

import { STAGE_TYPES, type Pipeline, type Stage } from '@vistar/shared';
import Link from 'next/link';
import { RadioGroup } from 'radix-ui';
import { useState, type FormEvent } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { fieldErrorMap, useCreateStage, useDeleteStage, useUpdateStage } from '@/lib/customization';
import { cn } from '@/lib/cn';
import { errorCode, errorMessage, InlineAlert } from '../common/states';
import { TAP_BUTTON } from '../common/touch';
import { STAGE_COLORS, STAGE_TYPE_LABELS, toneOfStage } from './stage-colors';

interface StageDraft {
  name: string;
  type: Stage['type'];
  probability: string;
  color: string | null;
  afterStageId: string | null;
}

const TYPE_HINT: Record<Stage['type'], string> = {
  open: 'Work in progress',
  won: 'Counts as a sale',
  lost: 'Closed without a sale',
};

function validate(d: StageDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.name.trim()) e.name = 'Enter a stage name';
  else if (d.name.trim().length > 40) e.name = 'Use up to 40 characters';
  const p = Number(d.probability);
  if (d.probability.trim() === '' || !Number.isInteger(p) || p < 0 || p > 100) e.probability = 'Enter a whole number from 0 to 100';
  return e;
}

function ColorPicker({ value, onChange, preview }: { value: string | null; onChange: (v: string | null) => void; preview: Pick<Stage, 'key' | 'type'> & { name: string } }) {
  const options = [{ hex: null as string | null, label: 'Automatic' }, ...STAGE_COLORS.map((c) => ({ hex: c.hex as string | null, label: c.label }))];
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs font-medium text-fg-secondary">Colour</legend>
      <RadioGroup.Root value={value ?? 'auto'} onValueChange={(v) => onChange(v === 'auto' ? null : v)} className="flex flex-wrap gap-1.5" aria-label="Stage colour">
        {options.map((o) => {
          const tone = toneOfStage({ ...preview, color: o.hex });
          return (
            <RadioGroup.Item
              key={o.label}
              value={o.hex ?? 'auto'}
              className={cn(
                'focus-ring inline-flex h-8 items-center gap-1.5 rounded-full border border-transparent px-1 data-[state=checked]:border-accent data-[state=checked]:ring-1 data-[state=checked]:ring-accent',
                TAP_BUTTON,
              )}
            >
              <Chip tone={tone} dot size="md">
                {o.label}
              </Chip>
            </RadioGroup.Item>
          );
        })}
      </RadioGroup.Root>
      <p className="text-xs text-muted">Colours use soft tints that stay readable in light and dark themes. Automatic picks one from the stage type.</p>
    </fieldset>
  );
}

function StageFields({ draft, set, errors, pipeline, showPosition, editing }: { draft: StageDraft; set: (p: Partial<StageDraft>) => void; errors: Record<string, string>; pipeline: Pipeline; showPosition: boolean; editing?: Stage }) {
  return (
    <div className="flex flex-col gap-4">
      <FormField label="Stage name" required error={errors.name} hint={editing ? `Key ${editing.key} stays the same, so workflows and reports keep working.` : undefined}>
        <Input value={draft.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} autoFocus />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Type" hint={TYPE_HINT[draft.type]}>
          <NativeSelect value={draft.type} onChange={(e) => set({ type: e.target.value as Stage['type'] })}>
            {STAGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {STAGE_TYPE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Win probability (%)" error={errors.probability} hint="Used for the revenue forecast">
          <Input type="number" inputMode="numeric" min={0} max={100} step={1} value={draft.probability} onChange={(e) => set({ probability: e.target.value })} />
        </FormField>
      </div>
      {showPosition && (
        <FormField label="Position">
          <NativeSelect value={draft.afterStageId ?? '__start'} onChange={(e) => set({ afterStageId: e.target.value === '__start' ? null : e.target.value })}>
            <option value="__start">At the start</option>
            {pipeline.stages.map((s) => (
              <option key={s.id} value={s.id}>
                After {s.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      )}
      <ColorPicker value={draft.color} onChange={(color) => set({ color })} preview={{ key: editing?.key ?? '', type: draft.type, name: draft.name }} />
    </div>
  );
}

function serverErrors(e: unknown) {
  const map = fieldErrorMap(e);
  return { fields: map, message: Object.keys(map).length ? null : errorMessage(e) };
}

/** Add a stage after a chosen stage (default: after the last open stage, before Won and Lost). */
export function AddStageDialog({ open, onOpenChange, pipeline }: { open: boolean; onOpenChange: (o: boolean) => void; pipeline: Pipeline }) {
  const lastOpen = [...pipeline.stages].reverse().find((s) => s.type === 'open') ?? pipeline.stages.at(-1);
  const initial: StageDraft = { name: '', type: 'open', probability: '20', color: null, afterStageId: lastOpen?.id ?? null };
  const [draft, setDraft] = useState<StageDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateStage();

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setDraft(initial);
      setErrors({});
      setFormError(null);
    }
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const local = validate(draft);
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) return;
    try {
      const stage = await create.mutateAsync({
        pipelineId: pipeline.id,
        body: { name: draft.name.trim(), type: draft.type, probability: Number(draft.probability), color: draft.color, afterStageId: draft.afterStageId },
      });
      toast.success(`Stage ${stage.name} added`);
      close(false);
    } catch (err) {
      const s = serverErrors(err);
      setErrors(s.fields);
      setFormError(s.message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="lg">
        <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Add stage</DialogTitle>
            <DialogDescription>New stages appear on the Board and in stage pickers right away.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {formError && <InlineAlert className="mb-3">{formError}</InlineAlert>}
            <StageFields draft={draft} set={(p) => setDraft((d) => ({ ...d, ...p }))} errors={errors} pipeline={pipeline} showPosition />
          </DialogBody>
          <DialogFooter>
            <Button className={TAP_BUTTON} onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" className={TAP_BUTTON} loading={create.isPending}>
              Add stage
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Rename, recolour, change type or probability. Mounted per stage (key = stage id). */
export function EditStageDialog({ stage, pipeline, onClose }: { stage: Stage; pipeline: Pipeline; onClose: () => void }) {
  const [draft, setDraft] = useState<StageDraft>({ name: stage.name, type: stage.type, probability: String(stage.probability), color: stage.color, afterStageId: null });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const update = useUpdateStage();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const local = validate(draft);
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) return;
    try {
      const saved = await update.mutateAsync({ stageId: stage.id, patch: { name: draft.name.trim(), type: draft.type, probability: Number(draft.probability), color: draft.color } });
      toast.success(`Stage ${saved.name} saved`);
      onClose();
    } catch (err) {
      const s = serverErrors(err);
      setErrors(s.fields);
      setFormError(s.message);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Edit stage {stage.name}</DialogTitle>
            <DialogDescription>Leads in this stage stay where they are.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {formError && <InlineAlert className="mb-3">{formError}</InlineAlert>}
            <StageFields draft={draft} set={(p) => setDraft((d) => ({ ...d, ...p }))} errors={errors} pipeline={pipeline} showPosition={false} editing={stage} />
          </DialogBody>
          <DialogFooter>
            <Button className={TAP_BUTTON} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" className={TAP_BUTTON} loading={update.isPending}>
              Save stage
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Delete confirmation. STAGE_IN_USE and "at least two stages" come back from the data layer and show here. */
export function DeleteStageDialog({ stage, onClose }: { stage: Stage; onClose: () => void }) {
  const del = useDeleteStage();
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);

  async function onDelete() {
    setError(null);
    try {
      await del.mutateAsync(stage.id);
      toast.success(`Stage ${stage.name} deleted`);
      onClose();
    } catch (err) {
      setError({ code: errorCode(err), message: errorMessage(err) });
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Delete stage {stage.name}?</DialogTitle>
          <DialogDescription>Only empty stages can be deleted. Workflows that move leads to this stage stop at that step until you pick another stage.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {error && (
            <InlineAlert title={error.code === 'STAGE_IN_USE' ? 'This stage still has leads' : 'Stage not deleted'}>
              <p>{error.message}.</p>
              {error.code === 'STAGE_IN_USE' && (
                <p className="mt-1">
                  <Link href="/app/leads" className="font-medium underline underline-offset-2">
                    Open Leads
                  </Link>{' '}
                  and move them to another stage, then try again.
                </p>
              )}
            </InlineAlert>
          )}
          {!error && <p className="text-sm text-fg-secondary">This cannot be undone. You can add a stage with the same name later.</p>}
        </DialogBody>
        <DialogFooter>
          <Button className={TAP_BUTTON} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" className={TAP_BUTTON} loading={del.isPending} onClick={onDelete}>
            Delete stage
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
