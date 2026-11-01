'use client';

import {
  LEAD_SOURCES,
  LeadCreateSchema,
  normalizeIndianPhone,
  type LeadCreate,
} from '@vistar/shared';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useCreateLead } from '@/lib/leads/data';
import { useCan, useMe } from '@/lib/session/session';
import { useLeadActions } from '@/components/leads-shared/lead-actions';
import { SOURCE_LABEL, STAGES, useScopedUsers } from './lead-meta';
import { Select } from './primitives/select';
import { useRecentLeads } from './stores';

type Field =
  | 'name'
  | 'phone'
  | 'email'
  | 'companyName'
  | 'city'
  | 'valueInr'
  | 'tags'
  | 'requirement'
  | 'source'
  | 'stageId'
  | 'ownerId';
type Errors = Partial<Record<Field | 'form', string>>;

const EMPTY = {
  name: '',
  phone: '',
  email: '',
  companyName: '',
  city: '',
  valueInr: '',
  tags: '',
  requirement: '',
};

/** "New lead" dialog. Validates with LeadCreateSchema (same schema the API uses) before saving. */
export function CreateLeadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const me = useMe();
  const canAssign = useCan('leads.assign');
  const users = useScopedUsers();
  const create = useCreateLead();
  const markRecent = useRecentLeads((s) => s.mark);
  const actions = useLeadActions();
  const [form, setForm] = useState(EMPTY);
  const [source, setSource] = useState<LeadCreate['source']>('manual');
  const [stageId, setStageId] = useState(STAGES[0]!.id);
  const [ownerId, setOwnerId] = useState(me?.user.id ?? '');
  const [errors, setErrors] = useState<Errors>({});

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined, form: undefined }));
  };

  const reset = () => {
    setForm(EMPTY);
    setSource('manual');
    setStageId(STAGES[0]!.id);
    setOwnerId(me?.user.id ?? '');
    setErrors({});
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    let phone: string | undefined;
    if (form.phone.trim()) {
      phone = normalizeIndianPhone(form.phone) ?? undefined;
      if (!phone) next.phone = 'Enter a 10-digit Indian mobile number, e.g. 98765 43210';
    }
    const value = form.valueInr.replace(/[₹,\s]/g, '');
    if (value && !/^\d+$/.test(value)) next.valueInr = 'Enter the deal value in whole rupees';
    const input = {
      name: form.name,
      phone,
      email: form.email.trim() || undefined,
      companyName: form.companyName.trim() || undefined,
      city: form.city.trim() || undefined,
      requirement: form.requirement.trim() || undefined,
      source,
      stageId,
      ownerId: canAssign ? ownerId || undefined : me?.user.id,
      valueInr: value ? Number(value) : 0,
      tags: form.tags
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    };
    const parsed = LeadCreateSchema.safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as Field | undefined;
        if (!key || next[key]) continue;
        next[key] =
          key === 'name'
            ? 'Enter the lead name'
            : key === 'email'
              ? 'Enter a valid email, e.g. rakesh@company.in'
              : key === 'tags'
                ? 'Tags can be up to 40 characters, 30 tags at most'
                : key === 'valueInr'
                  ? 'Enter a value up to ₹200 crore'
                  : issue.message;
      }
    }
    if (Object.keys(next).length || !parsed.success) {
      setErrors(next);
      return;
    }
    try {
      const lead = await create.mutateAsync(parsed.data);
      markRecent([lead.id]);
      toast.success(`Lead created: ${lead.name}`, {
        action: { label: 'Open', onClick: () => actions.open(lead) },
      });
      reset();
      onOpenChange(false);
    } catch {
      setErrors({ form: 'The lead was not saved. Check your connection and try again.' });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent size="lg">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>New lead</DialogTitle>
            <DialogDescription>
              Add an enquiry by hand. Leads from IndiaMART, WhatsApp and your website arrive
              automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" required error={errors.name} className="sm:col-span-2">
              <Input
                value={form.name}
                onChange={set('name')}
                autoFocus
                autoComplete="off"
                placeholder="Full name, e.g. Rakesh Gupta"
              />
            </FormField>
            <FormField label="Phone" error={errors.phone} hint="Indian mobile number">
              <Input
                value={form.phone}
                onChange={set('phone')}
                inputMode="tel"
                autoComplete="off"
                placeholder="98765 43210"
              />
            </FormField>
            <FormField label="Email" error={errors.email}>
              <Input
                value={form.email}
                onChange={set('email')}
                type="email"
                autoComplete="off"
                placeholder="rakesh@company.in"
              />
            </FormField>
            <FormField label="Company" error={errors.companyName}>
              <Input
                value={form.companyName}
                onChange={set('companyName')}
                placeholder="Shree Ganesh Traders"
              />
            </FormField>
            <FormField label="City" error={errors.city}>
              <Input value={form.city} onChange={set('city')} placeholder="Ahmedabad" />
            </FormField>
            <FormField label="Source">
              <Select
                value={source}
                onValueChange={(v) => setSource(v as LeadCreate['source'])}
                options={LEAD_SOURCES.map((s) => ({ value: s, label: SOURCE_LABEL[s] }))}
              />
            </FormField>
            <FormField label="Stage">
              <Select
                value={stageId}
                onValueChange={setStageId}
                options={STAGES.map((s) => ({ value: s.id, label: s.name }))}
              />
            </FormField>
            <FormField
              label="Owner"
              hint={canAssign ? undefined : 'New leads you create are assigned to you'}
            >
              <Select
                value={canAssign ? ownerId : (me?.user.id ?? '')}
                onValueChange={setOwnerId}
                disabled={!canAssign}
                options={users.map((u) => ({
                  value: u.id,
                  label: u.id === me?.user.id ? `${u.name} (you)` : u.name,
                }))}
              />
            </FormField>
            <FormField label="Deal value (₹)" error={errors.valueInr}>
              <Input
                value={form.valueInr}
                onChange={set('valueInr')}
                inputMode="numeric"
                placeholder="1,50,000"
              />
            </FormField>
            <FormField
              label="Tags"
              error={errors.tags}
              hint="Separate with commas"
              className="sm:col-span-2"
            >
              <Input value={form.tags} onChange={set('tags')} placeholder="bulk, gst-registered" />
            </FormField>
            <FormField label="Requirement" error={errors.requirement} className="sm:col-span-2">
              <Textarea
                value={form.requirement}
                onChange={set('requirement')}
                placeholder="Needs 500 m of 2 inch SS pipe, delivery to Rajkot"
              />
            </FormField>
            {errors.form && (
              <p role="alert" className="text-sm text-danger-text sm:col-span-2">
                {errors.form}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary" loading={create.isPending}>
              Create lead
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
