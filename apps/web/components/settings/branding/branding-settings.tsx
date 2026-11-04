'use client';

import { useState, type FormEvent } from 'react';
import { FormField, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { chartPresetOf, useBranding, useSaveBranding, type BrandingDraft } from '@/lib/branding';
import { useMe } from '@/lib/session/session';
import { SaveBar, SettingsCard } from '../settings-card';
import { AssetField } from './asset-field';
import { BrandColorField } from './brand-color-field';
import { BrandPreview } from './brand-preview';
import { ChartPaletteField } from './chart-palette-field';

const same = (a: BrandingDraft, b: BrandingDraft) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Settings > Branding (SPEC 29.4, D-060): display name, logos for light and dark, favicon, brand colour
 * with the live AA check, dashboard and chart palette, and the sign-in page image. One save for the
 * page; the live preview shows the draft in both themes before anything changes for the team.
 */
export function BrandingSettings() {
  const me = useMe()!;
  const saved = useBranding();
  const save = useSaveBranding();
  const { reason } = useReadOnly();
  const [draft, setDraft] = useState<BrandingDraft>(saved);
  const [seen, setSeen] = useState(saved);
  if (!same(seen, saved)) {
    setSeen(saved);
    setDraft(saved);
  }
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = !same(draft, saved);
  const disabled = !!reason;
  const set = <K extends keyof BrandingDraft>(k: K, v: BrandingDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  // "Brand first" charts follow the brand colour.
  const setBrandColor = (brandColor: string | null) =>
    setDraft((d) => {
      const brandFirst = !!d.chartPalette && chartPresetOf(d.chartPalette, d.brandColor) === 'brand';
      return { ...d, brandColor, chartPalette: brandFirst && d.chartPalette ? [brandColor ?? '#4F46E5', ...d.chartPalette.slice(1)] : d.chartPalette };
    });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const name = draft.displayName?.trim() ?? '';
    if (name && (name.length < 2 || name.length > 60)) {
      setNameError('Use 2 to 60 characters, or leave it empty to use the company name.');
      return;
    }
    setNameError(null);
    setSaving(true);
    try {
      await save({ ...draft, displayName: name || null });
      toast.success('Branding saved. Everyone sees it on their next screen.');
    } catch {
      toast.error('Branding not saved. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  const footer = <SaveBar dirty={dirty} saving={saving} readOnlyReason={reason} onDiscard={() => setDraft(saved)} />;

  return (
    <form onSubmit={onSubmit} noValidate className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)] 3xl:grid-cols-[minmax(0,1fr)_minmax(0,44rem)]">
      <div className="flex min-w-0 flex-col gap-4">
        <SettingsCard title="Name and logo" description="Shown in the sidebar, the browser tab, the sign-in page and emails.">
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
            <FormField label="Display name" error={nameError ?? undefined} hint={`Leave empty to use “${me.workspace.name}”.`} className="md:col-span-2 2xl:col-span-4">
              <Input value={draft.displayName ?? ''} maxLength={60} placeholder={me.workspace.name} disabled={disabled} onChange={(e) => set('displayName', e.target.value || null)} />
            </FormField>
            <AssetField asset="logoLight" value={draft.logoLight} onChange={(v) => set('logoLight', v)} disabled={disabled} previewTheme="light" />
            <AssetField asset="logoDark" value={draft.logoDark} onChange={(v) => set('logoDark', v)} disabled={disabled} previewTheme="dark" />
            <AssetField asset="favicon" value={draft.favicon} onChange={(v) => set('favicon', v)} disabled={disabled} />
          </div>
        </SettingsCard>

        <SettingsCard title="Brand colour" description="Buttons, links, selection and focus rings use it. Tootodo adjusts the lightness so text stays readable (WCAG AA) in light and dark.">
          <BrandColorField value={draft.brandColor} onChange={setBrandColor} disabled={disabled} />
        </SettingsCard>

        <SettingsCard title="Dashboard and chart colours" description="The six series colours of the dashboard, reports and sparklines.">
          <ChartPaletteField value={draft.chartPalette} brandColor={draft.brandColor} onChange={(v) => set('chartPalette', v)} disabled={disabled} />
        </SettingsCard>

        <SettingsCard title="Sign-in page" description="The image next to the sign-in form on your custom domain." footer={footer}>
          <AssetField asset="loginImage" value={draft.loginImage} onChange={(v) => set('loginImage', v)} disabled={disabled} className="max-w-2xl" />
        </SettingsCard>
      </div>

      <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-0">
        <SettingsCard title="Preview" description={dirty ? 'Unsaved changes, shown in both themes.' : 'What your team sees, in both themes.'}>
          <BrandPreview draft={draft} name={draft.displayName?.trim() || me.workspace.name} />
        </SettingsCard>
      </div>
    </form>
  );
}
