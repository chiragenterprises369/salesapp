'use client';

import Link from 'next/link';
import { createContext, useContext, type ReactNode } from 'react';
import { BrandMark } from '@/components/shell/brand-mark';
import { Logo } from '@/components/shell/logo';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { usePublicBranding, type PublicBranding } from '@/lib/branding';
import { usePublicPlatformInfo } from '@/lib/config/public';
import { cn } from '@/lib/cn';

/** Company name on a branded sign-in page (custom domain or `<slug>.localhost`); null on Vistar's own hosts. */
const AuthBrandContext = createContext<string | null>(null);

/**
 * Page frame for sign-in, sign-up, invite and Super Admin sign-in: logo, theme toggle, centred column.
 *
 * On a company's custom domain (or `<slug>.localhost` in development) the workspace pages show that
 * company's branding from GET /public/resolve-host (SPEC 29.4, D-060): its logo and name in the header,
 * its sign-in image beside the form on wide screens, and its name in the card titles. Colours, favicon
 * and component design come from BrandingProvider. The Super Admin sign-in (`brand={false}`) never
 * shows a company's branding.
 */
export function AuthFrame({ children, badge, brand = true }: { children: ReactNode; badge?: ReactNode; brand?: boolean }) {
  const query = usePublicBranding(brand);
  const b: PublicBranding | null = (brand && query.data) || null;
  const image = b?.loginImage?.url ?? null;

  return (
    <AuthBrandContext.Provider value={b?.workspaceName ?? null}>
      <div className={cn('min-h-dvh', image ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : 'flex flex-col')}>
        {image && <SignInImage src={image} name={b!.workspaceName} />}
        <div className="flex min-h-dvh min-w-0 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4 sm:px-6">
            <span className="flex min-w-0 items-center gap-2">
              {b ? (
                <Link href="/login" className="focus-ring flex min-w-0 items-center gap-2 rounded-md">
                  <BrandMark logo={{ light: b.logoLight?.url ?? null, dark: b.logoDark?.url ?? null }} />
                  <span className="truncate text-sm font-semibold text-fg">{b.workspaceName}</span>
                </Link>
              ) : (
                <Link href="/" className="focus-ring rounded-md" aria-label="Vistar home">
                  <Logo />
                </Link>
              )}
              {badge}
            </span>
            <ThemeToggle />
          </header>
          <main className="flex flex-1 justify-center px-4 pt-4 pb-12 sm:items-center sm:pt-0">
            <div className="flex w-full max-w-sm flex-col gap-4">
              {children}
              {b && <p className="text-center text-xs text-muted-strong">Powered by Vistar</p>}
              {/* ---- change #20: config (platform branding: legal links and support from Super Admin > Config) */}
              <PlatformLinks />
            </div>
          </main>
        </div>
      </div>
    </AuthBrandContext.Provider>
  );
}

/** Terms, privacy and support from the platform branding (GET /public/platform); nothing when unset. */
function PlatformLinks() {
  const info = usePublicPlatformInfo().data;
  if (!info) return null;
  const links = [
    info.termsUrl ? { label: 'Terms', href: info.termsUrl } : null,
    info.privacyUrl ? { label: 'Privacy', href: info.privacyUrl } : null,
    info.supportEmail ? { label: `Help: ${info.supportEmail}`, href: `mailto:${info.supportEmail}` } : null,
  ].filter((l): l is { label: string; href: string } => !!l);
  if (!links.length) return null;
  return (
    <nav aria-label={`${info.productName} links`} className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-strong">
      {links.map((l) => (
        <a key={l.label} href={l.href} target={l.href.startsWith('mailto:') ? undefined : '_blank'} rel="noopener noreferrer" className="focus-ring rounded-xs underline-offset-4 hover:text-fg hover:underline">
          {l.label}
        </a>
      ))}
    </nav>
  );
}

/** The company's sign-in image, beside the form from 1024 px (decorative; the name is in the header). */
function SignInImage({ src, name }: { src: string; name: string }) {
  return (
    <aside aria-hidden className="relative hidden overflow-hidden bg-surface-3 lg:block" data-slot="sign-in-image">
      {/* Uploaded files of any size and origin: next/image would need a loader for each source. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="absolute inset-0 size-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/70 via-black/35 to-transparent px-10 pt-24 pb-10">
        <p className="text-2xl font-semibold tracking-tight text-white">{name}</p>
        <p className="mt-1 text-sm text-white/90">Sign in to your sales workspace</p>
      </div>
    </aside>
  );
}

/** The single card that holds an auth form. On a branded host "Vistar" in the title becomes the company name. */
export function AuthCard({ title, description, children, className }: { title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  const company = useContext(AuthBrandContext);
  const shown = company ? title.replace(/\bVistar\b/, company) : title;
  return (
    <section
      className={cn(
        'card relative overflow-hidden rounded-[22px] border border-hair bg-gradient-to-b from-[var(--card-top,#191c20)] to-[var(--card,#121517)] p-7 md:p-8 shadow-[var(--shadow-card)]',
        className,
      )}
      aria-labelledby="auth-title"
    >
      <h1 id="auth-title" className="text-2xl font-bold tracking-tight text-ink font-display">
        {shown}
      </h1>
      {description && <p className="mt-1.5 text-sm text-faint leading-relaxed">{description}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

/** Form-level message (wrong password, expired challenge). Announced; paired with field errors, not a toast. */
export function FormAlert({ tone = 'danger', children }: { tone?: 'danger' | 'info'; children: ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'rounded-[10px] border px-3.5 py-2.5 text-xs font-medium leading-relaxed',
        tone === 'danger'
          ? 'border-status-red-border bg-status-red-bg text-status-red-fg'
          : 'border-hair-2 bg-well-2 text-ink',
      )}
    >
      {children}
    </div>
  );
}

export function OrDivider() {
  return (
    <div className="my-4 flex items-center gap-3 text-xs text-muted" aria-hidden>
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
