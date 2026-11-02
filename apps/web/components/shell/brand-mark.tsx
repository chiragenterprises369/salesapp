'use client';

import { cn } from '@/lib/cn';
import { useBranding } from '@/lib/branding';
import { useDocumentTheme } from '@/lib/use-document-theme';
import { LogoMark } from './logo';

/**
 * The company logo for the current theme (dark logo in dark, light logo in light, the other one as a
 * fallback), or the Vistar mark in the brand colour when no logo is uploaded. Decorative: pair it
 * with the visible company name.
 */
export function BrandMark({ className, logo }: { className?: string; logo?: { light: string | null; dark: string | null } }) {
  const branding = useBranding();
  const theme = useDocumentTheme();
  const light = logo ? logo.light : (branding.logoLight?.url ?? null);
  const dark = logo ? logo.dark : (branding.logoDark?.url ?? null);
  const src = theme === 'dark' ? (dark ?? light) : (light ?? dark);
  if (!src) return <LogoMark className={className} />;
  return (
    // Data URLs and uploaded files of any size: next/image would need a loader for each source.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" data-slot="brand-logo" className={cn('h-7 w-auto max-w-28 shrink-0 object-contain', className)} />
  );
}
