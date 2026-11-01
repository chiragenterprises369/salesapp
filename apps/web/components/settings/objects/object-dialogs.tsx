'use client';

import { FIELD_TYPE_LABELS, ObjectKeySchema, type CustomObject, type FieldSpecInput } from '@vistar/shared';
import { Pencil, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Switch } from '@/components/common/switch';
import { NavIcon } from '@/components/shell/nav-icon';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { fieldErrorMap, useArchiveObject, useCreateObject, useUpdateObject } from '@/lib/customization';
import { pluralize, toKey } from '../common/keys';
import { errorMessage, InlineAlert } from '../common/states';
import { TAP_BUTTON, TAP_ICON } from '../common/touch';
import { FieldEditorDialog } from '../fields/field-editor-dialog';
import { draftFrom } from '../fields/field-draft';
import { FieldTypeIcon } from '../fields/field-type-icon';
import { IconPicker } from './icon-picker';

const NAME_FIELD: FieldSpecInput = { key: 'name', label: 'Name', type: 'text', required: true, config: { maxLength: 200 } } as FieldSpecInput;

function NavSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <span className="min-w-0">
        <label htmlFor="object-nav" className="block text-sm font-medium text-fg">
          Show in navigation
        </label>
        <span id="object-nav-hint" className="block text-xs text-muted">
          Adds it to the sidebar under Work, after Leads
        </span>
      </span>
      <Switch id="object-nav" checked={checked} onCheckedChange={onChange} disabled={disabled} aria-describedby="object-nav-hint" />
    </div>
  );
}

function useFocusFirstError(tick: number, root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (tick) root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [tick, root]);
}

type FieldEdit = { index: number } | { index: null } | null;

/** Create a custom object: names, key, icon, navigation, title field and its first fields (field editor reused). */
export function CreateObjectDialog({ onClose, onCreated, readOnlyReason }: { onClose: () => void; onCreated: (o: CustomObject) => void; readOnlyReason?: string | null }) {
  const create = useCreateObject();
  const [singular, setSingular] = useState('');
  const [plural, setPlural] = useState('');
  const [pluralEdited, setPluralEdited] = useState(false);
  const [key, setKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [icon, setIcon] = useState('Box');
  const [description, setDescription] = useState('');
  const [showInNav, setShowInNav] = useState(true);
  const [fields, setFields] = useState<FieldSpecInput[]>([NAME_FIELD]);
  const [titleKey, setTitleKey] = useState('name');
  const [fieldEdit, setFieldEdit] = useState<FieldEdit>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  useFocusFirstError(tick, bodyRef);
  const disabled = !!readOnlyReason;

  const textFields = fields.filter((f) => f.type === 'text');
  const onSingular = (v: string) => {
    setSingular(v);
    if (!pluralEdited) setPlural(pluralize(v));
    if (!keyEdited) setKey(toKey(v));
  };

  function validate() {
    const e: Record<string, string> = {};
    if (!singular.trim()) e.labelSingular = 'Enter a name';
    if (!plural.trim()) e.labelPlural = 'Enter the plural name';
    if (!ObjectKeySchema.safeParse(key).success) e.key = 'Use 2 to 40 lowercase letters, digits or _, starting with a letter';
    if (!textFields.some((f) => f.key === titleKey)) e.primaryFieldKey = 'Pick a text field as the title';
    if (fields.length === 0) e.fields = 'Add at least one field';
    return e;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const local = validate();
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) {
      setFormError('Check the highlighted fields.');
      setTick((n) => n + 1);
      return;
    }
    try {
      const o = await create.mutateAsync({
        key,
        labelSingular: singular.trim(),
        labelPlural: plural.trim(),
        icon,
        description: description.trim() || undefined,
        showInNav,
        primaryFieldKey: titleKey,
        fields,
      });
      toast.success(`${o.labelPlural} created`, { description: showInNav ? 'It is now in the sidebar under Work.' : undefined });
      onCreated(o);
    } catch (err) {
      const map = fieldErrorMap(err);
      setErrors(map);
      setFormError(errorMessage(err));
      setTick((n) => n + 1);
    }
  }

  const editing = fieldEdit && fieldEdit.index !== null ? fields[fieldEdit.index] : undefined;
  const takenKeys = fields.filter((_, i) => i !== fieldEdit?.index).map((f) => f.key);

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent size="xl">
          <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
            <DialogHeader>
              <DialogTitle>New custom object</DialogTitle>
              <DialogDescription>A record type of your own, like Suppliers, Projects or Branches, with its own fields and page.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <div ref={bodyRef} className="flex flex-col gap-4">
                {readOnlyReason && <InlineAlert tone="info">{readOnlyReason}</InlineAlert>}
                {formError && <InlineAlert>{formError}</InlineAlert>}
                <div className="grid gap-4 sm:grid-cols-3">
                  <FormField label="Name (singular)" required error={errors.labelSingular} hint="e.g. Supplier">
                    <Input value={singular} maxLength={40} onChange={(e) => onSingular(e.target.value)} autoFocus disabled={disabled} />
                  </FormField>
                  <FormField label="Name (plural)" required error={errors.labelPlural} hint="e.g. Suppliers">
                    <Input
                      value={plural}
                      maxLength={40}
                      onChange={(e) => {
                        setPlural(e.target.value);
                        setPluralEdited(true);
                      }}
                      disabled={disabled}
                    />
                  </FormField>
                  <FormField label="Key" required error={errors.key} hint="Used in links and the API. Cannot change later.">
                    <Input
                      value={key}
                      maxLength={40}
                      className="font-mono text-xs"
                      spellCheck={false}
                      autoCapitalize="off"
                      onChange={(e) => {
                        setKey(e.target.value);
                        setKeyEdited(true);
                      }}
                      disabled={disabled}
                    />
                  </FormField>
                </div>
                <IconPicker value={icon} onChange={setIcon} disabled={disabled} />
                <FormField label="Description (optional)" error={errors.description}>
                  <Textarea value={description} maxLength={300} rows={2} onChange={(e) => setDescription(e.target.value)} disabled={disabled} />
                </FormField>
                <NavSwitch checked={showInNav} onChange={setShowInNav} disabled={disabled} />

                <section aria-labelledby="object-fields-heading" className="flex flex-col gap-2 border-t border-border pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 id="object-fields-heading" className="text-sm font-semibold text-fg">
                        Fields
                      </h3>
                      <p className="text-xs text-muted">You can add, edit and reorder fields later in Custom fields.</p>
                    </div>
                    <Button size="sm" className={TAP_BUTTON} onClick={() => setFieldEdit({ index: null })} disabled={disabled}>
                      <Plus aria-hidden />
                      Add field
                    </Button>
                  </div>
                  {errors.fields && (
                    <p role="alert" className="text-xs text-danger-text">
                      {errors.fields}
                    </p>
                  )}
                  <ul className="divide-y divide-border rounded-md border border-border" aria-label="Fields of the new object">
                    {fields.map((f, i) => (
                      <li key={f.key || i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                        <FieldTypeIcon type={f.type} className="text-fg-secondary" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-fg">{f.label}</span>
                          <span className="text-xs text-muted">
                            {FIELD_TYPE_LABELS[f.type]} · <code className="font-mono text-2xs">{f.key}</code>
                          </span>
                        </span>
                        {f.key === titleKey && <Chip tone="indigo">Title field</Chip>}
                        {f.required && <Chip tone="amber">Required</Chip>}
                        <Button variant="ghost" size="icon-sm" className={TAP_ICON} aria-label={`Edit ${f.label}`} onClick={() => setFieldEdit({ index: i })} disabled={disabled}>
                          <Pencil aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className={TAP_ICON}
                          aria-label={`Remove ${f.label}`}
                          onClick={() => setFields((all) => all.filter((_, j) => j !== i))}
                          disabled={disabled || f.key === titleKey}
                          title={f.key === titleKey ? 'Pick another title field first' : undefined}
                        >
                          <X aria-hidden />
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <div className="max-w-sm">
                    <FormField label="Title field" required error={errors.primaryFieldKey} hint="A text field shown as the record name in lists and links">
                      <NativeSelect value={titleKey} onChange={(e) => setTitleKey(e.target.value)} disabled={disabled}>
                        {textFields.length === 0 && <option value="">Add a text field first</option>}
                        {textFields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormField>
                  </div>
                </section>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button className={TAP_BUTTON} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" className={TAP_BUTTON} loading={create.isPending} disabled={disabled}>
                Create object
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {fieldEdit && (
        <FieldEditorDialog
          key={fieldEdit.index ?? 'new'}
          mode="create"
          initial={editing ? draftFrom(editing, false) : undefined}
          targetName={plural.trim() || 'this object'}
          takenKeys={takenKeys}
          extraObjects={ObjectKeySchema.safeParse(key).success ? [{ key, labelPlural: plural.trim() || singular.trim() }] : []}
          submitLabel={editing ? 'Update field' : 'Add field'}
          onClose={() => setFieldEdit(null)}
          onSubmit={async (spec) => {
            setFields((all) => (fieldEdit.index === null ? [...all, spec] : all.map((f, i) => (i === fieldEdit.index ? spec : f))));
            if (editing && editing.key === titleKey && spec.type === 'text') setTitleKey(spec.key);
            setFieldEdit(null);
          }}
        />
      )}
    </>
  );
}

/** Edit names, icon, description, title field and navigation. The key never changes. */
export function EditObjectDialog({ object, onClose, readOnlyReason }: { object: CustomObject; onClose: () => void; readOnlyReason?: string | null }) {
  const update = useUpdateObject();
  const [singular, setSingular] = useState(object.labelSingular);
  const [plural, setPlural] = useState(object.labelPlural);
  const [icon, setIcon] = useState(object.icon);
  const [description, setDescription] = useState(object.description ?? '');
  const [showInNav, setShowInNav] = useState(object.showInNav);
  const [titleKey, setTitleKey] = useState(object.primaryFieldKey);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  useFocusFirstError(tick, bodyRef);
  const textFields = object.fields.filter((f) => f.type === 'text' && !f.archivedAt);
  const disabled = !!readOnlyReason;

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const local: Record<string, string> = {};
    if (!singular.trim()) local.labelSingular = 'Enter a name';
    if (!plural.trim()) local.labelPlural = 'Enter the plural name';
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) {
      setTick((n) => n + 1);
      return;
    }
    try {
      const o = await update.mutateAsync({
        key: object.key,
        patch: { labelSingular: singular.trim(), labelPlural: plural.trim(), icon, description: description.trim() || null, showInNav, primaryFieldKey: titleKey },
      });
      toast.success(`${o.labelPlural} saved`);
      onClose();
    } catch (err) {
      setErrors(fieldErrorMap(err));
      setFormError(errorMessage(err));
      setTick((n) => n + 1);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Edit {object.labelPlural}</DialogTitle>
            <DialogDescription>
              Key <code className="font-mono text-xs">{object.key}</code> stays the same, so links and integrations keep working.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div ref={bodyRef} className="flex flex-col gap-4">
              {readOnlyReason && <InlineAlert tone="info">{readOnlyReason}</InlineAlert>}
              {formError && <InlineAlert>{formError}</InlineAlert>}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Name (singular)" required error={errors.labelSingular}>
                  <Input value={singular} maxLength={40} onChange={(e) => setSingular(e.target.value)} disabled={disabled} />
                </FormField>
                <FormField label="Name (plural)" required error={errors.labelPlural}>
                  <Input value={plural} maxLength={40} onChange={(e) => setPlural(e.target.value)} disabled={disabled} />
                </FormField>
              </div>
              <IconPicker value={icon} onChange={setIcon} disabled={disabled} />
              <FormField label="Description (optional)" error={errors.description}>
                <Textarea value={description} maxLength={300} rows={2} onChange={(e) => setDescription(e.target.value)} disabled={disabled} />
              </FormField>
              <div className="max-w-sm">
                <FormField label="Title field" error={errors.primaryFieldKey} hint="A text field shown as the record name">
                  <NativeSelect value={titleKey} onChange={(e) => setTitleKey(e.target.value)} disabled={disabled}>
                    {textFields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              </div>
              <NavSwitch checked={showInNav} onChange={setShowInNav} disabled={disabled} />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button className={TAP_BUTTON} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" className={TAP_BUTTON} loading={update.isPending} disabled={disabled}>
              Save object
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Archive keeps every record; the object leaves the navigation until restored. */
export function ArchiveObjectDialog({ object, onClose }: { object: CustomObject; onClose: () => void }) {
  const archive = useArchiveObject();
  const [error, setError] = useState<string | null>(null);
  async function onArchive() {
    setError(null);
    try {
      await archive.mutateAsync(object.key);
      toast.success(`${object.labelPlural} archived`, { description: 'Records are kept. Restore it any time.' });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <NavIcon name={object.icon} fallback="Box" />
            Archive {object.labelPlural}?
          </DialogTitle>
          <DialogDescription>
            Its {object.recordCount ?? 0} records and their values are kept. {object.labelPlural} leaves the navigation and record pages until you restore it.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>{error && <InlineAlert>{error}</InlineAlert>}</DialogBody>
        <DialogFooter>
          <Button className={TAP_BUTTON} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" className={TAP_BUTTON} loading={archive.isPending} onClick={onArchive}>
            Archive object
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
