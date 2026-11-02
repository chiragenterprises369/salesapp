'use client';

import { normalizeIndianPhone, ProfileUpdateSchema, type AvatarConfig } from '@vistar/shared';
import { useState, type FormEvent } from 'react';
import { create } from 'zustand';
import { DEFAULT_AVATAR } from '@/components/employee/avatar-options';
import { AvatarEditor } from '@/components/employee/avatar-editor';
import { FormField, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { useReadOnly } from '@/lib/auth/use-auth';
import { useMe } from '@/lib/session/session';
import { SaveBar, SettingsCard } from './settings-card';

interface Profile {
  name: string;
  phone: string;
  title: string;
  avatar: AvatarConfig;
}

/** Wave 1 mock of PATCH /me/profile, per user id, for this tab. */
const useProfileStore = create<{ byUser: Record<string, Profile>; save: (id: string, p: Profile) => void }>()((set) => ({
  byUser: {},
  save: (id, p) => set((s) => ({ byUser: { ...s.byUser, [id]: p } })),
}));

type Field = 'name' | 'phone' | 'title';

/** Profile (name, phone, job title) and Team Floor avatar. `touch` = Employee panel 44px fields. */
export function ProfileForm({ touch = false }: { touch?: boolean }) {
  const me = useMe()!;
  const { reason } = useReadOnly();
  const stored = useProfileStore((s) => s.byUser[me.user.id]);
  const saveProfile = useProfileStore((s) => s.save);
  const saved: Profile = stored ?? {
    name: me.user.name,
    phone: me.user.phone ?? '',
    title: me.user.title ?? '',
    avatar: me.user.avatar ?? DEFAULT_AVATAR,
  };
  const [values, setValues] = useState<Profile>(saved);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const field = touch ? 'h-11 text-base' : undefined;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: Partial<Record<Field, string>> = {};
    const phone = values.phone.trim() ? normalizeIndianPhone(values.phone) : null;
    if (values.phone.trim() && !phone) next.phone = 'Enter a 10-digit Indian mobile number, like 98100 00003';
    const parsed = ProfileUpdateSchema.safeParse({ name: values.name.trim(), phone, title: values.title.trim() || null, avatar: values.avatar });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as Field;
        if (key === 'name') next.name = 'Enter your name, up to 80 characters';
        if (key === 'title') next.title = 'Use up to 80 characters';
      }
    }
    if (!values.name.trim()) next.name = 'Enter your name';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    await new Promise((r) => setTimeout(r, 300));
    const clean = { ...values, name: values.name.trim(), title: values.title.trim(), phone: phone ?? '' };
    saveProfile(me.user.id, clean);
    setValues(clean);
    setSaving(false);
    toast.success('Profile saved');
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <SettingsCard
        title="Profile"
        description="Your name and number as they appear across Vistar."
        footer={<SaveBar dirty={dirty} saving={saving} readOnlyReason={reason} onDiscard={() => setValues(saved)} />}
      >
        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          <FormField label="Name" error={errors.name} required>
            <Input className={field} autoComplete="name" value={values.name} maxLength={80} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} />
          </FormField>
          <FormField label="Mobile number" error={errors.phone} hint="Used for click-to-call: Vistar rings this number first">
            <Input
              className={field}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={values.phone}
              onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))}
            />
          </FormField>
          <FormField label="Job title" error={errors.title}>
            <Input className={field} value={values.title} maxLength={80} placeholder="Sales Executive" onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))} />
          </FormField>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-secondary">Email and role</span>
            <span className={cn('text-sm text-fg', touch && 'text-base')}>{me.user.email}</span>
            <span className="text-xs text-muted">{me.role.name}. Ask a company admin to change your email or role.</span>
          </div>
        </div>
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="mb-3 text-sm font-semibold text-fg">Team Floor avatar</h3>
          <AvatarEditor value={values.avatar} onChange={(avatar) => setValues((v) => ({ ...v, avatar }))} disabled={!!reason} />
        </div>
      </SettingsCard>
    </form>
  );
}
