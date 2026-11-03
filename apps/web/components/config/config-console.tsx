'use client';

import type { ConfigGroup, ConfigGroupKey, PlatformEmailTemplateKey } from '@vistar/shared';
import { useIsMutating } from '@tanstack/react-query';
import {
  BellRing,
  Bug,
  CreditCard,
  FileText,
  HardDrive,
  KeyRound,
  Landmark,
  Mail,
  MessageCircle,
  Palette,
  PhoneCall,
  Rocket,
  Settings2,
  ShieldCheck,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { RazorpayCard } from '@/components/billing/super/razorpay-card';
import { NativeSelect } from '@/components/common/native-select';
import { PageHeader } from '@/components/common/page-header';
import { InlineAlert, LoadError } from '@/components/settings/common/states';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfigRegistry, useRefreshRegistry } from '@/lib/config/platform';
import { cn } from '@/lib/cn';
import { VistarBillingProfileCard } from './billing-profile-card';
import { GoLiveChecklistPanel } from './go-live';
import { GroupAudit } from './group-audit';
import { FirebaseCard, ReleasesCard } from './platform-cards';
import { isPlatformTemplateKey, PlatformTemplates } from './platform-templates';
import { RegistryGroupPanel } from './registry-group';
import { GROUP_STATUS, GroupStatusChip } from './status';

export const GO_LIVE = 'go_live';
export const EMAIL_TEMPLATES = 'email_templates';

const ICONS: Record<string, LucideIcon> = {
  Mail,
  HardDrive,
  KeyRound,
  MessageCircle,
  PhoneCall,
  Bug,
  ShieldCheck,
  Palette,
  Landmark,
  CreditCard,
  BellRing,
  Smartphone,
};

interface Section {
  key: string;
  label: string;
  icon: LucideIcon;
  group: ConfigGroup | null;
}

function buildSections(groups: readonly ConfigGroup[]): Section[] {
  const out: Section[] = [{ key: GO_LIVE, label: 'Go-live checklist', icon: Rocket, group: null }];
  for (const g of groups) {
    out.push({ key: g.key, label: g.label, icon: ICONS[g.icon] ?? Settings2, group: g });
    // Platform templates sit right after the platform e-mail sender.
    if (g.key === 'email') out.push({ key: EMAIL_TEMPLATES, label: 'Platform e-mail templates', icon: FileText, group: null });
  }
  if (!out.some((s) => s.key === EMAIL_TEMPLATES)) out.push({ key: EMAIL_TEMPLATES, label: 'Platform e-mail templates', icon: FileText, group: null });
  return out;
}

/**
 * Super Admin > Config (change #20, SPEC 30): every key, token, secret, template and setting of the
 * platform in one grouped page. Left: groups with their status chips (configured, missing, env fallback,
 * dev default); right: the selected group. Registry groups render their fields from the contract; the
 * existing cards (Vistar billing profile, Razorpay, Firebase, Android releases) render inside the same
 * layout. `?group=<key>` (and `&template=<key>`) keeps the selection in the URL.
 */
export function ConfigConsole({ initialGroup, initialTemplate }: { initialGroup: string | null; initialTemplate: string | null }) {
  return (
    <RequirePermission anyOf={['platform.system.manage']}>
      <ConfigConsoleBody initialGroup={initialGroup} initialTemplate={initialTemplate} />
    </RequirePermission>
  );
}

function ConfigConsoleBody({ initialGroup, initialTemplate }: { initialGroup: string | null; initialTemplate: string | null }) {
  const registry = useConfigRegistry();
  const sections = useMemo(() => buildSections(registry.data?.groups ?? []), [registry.data]);
  const [selected, setSelected] = useState<string>(initialGroup ?? GO_LIVE);
  const [template, setTemplate] = useState<PlatformEmailTemplateKey | null>(isPlatformTemplateKey(initialTemplate) ? initialTemplate : null);
  const detailRef = useRef<HTMLDivElement>(null);
  const current = sections.find((s) => s.key === selected || s.group?.cardAnchor === selected) ?? sections[0]!;

  useEffect(() => {
    const url = new URL(window.location.href);
    // Go-live and the platform templates have their own paths (nav children); groups use ?group=.
    url.pathname = current.key === GO_LIVE ? '/super-admin/config/go-live' : current.key === EMAIL_TEMPLATES ? '/super-admin/config/email-templates' : '/super-admin/config';
    if (current.key === GO_LIVE || current.key === EMAIL_TEMPLATES) url.searchParams.delete('group');
    else url.searchParams.set('group', current.key);
    url.searchParams.delete('section');
    if (current.key === EMAIL_TEMPLATES && template) url.searchParams.set('template', template);
    else url.searchParams.delete('template');
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url.href);
  }, [current.key, template]);

  // Card groups change through their own routes: refresh their status chips when a card mutation ends.
  const mutating = useIsMutating();
  const refresh = useRefreshRegistry();
  const wasMutating = useRef(false);
  useEffect(() => {
    if (mutating > 0) wasMutating.current = true;
    else if (wasMutating.current) {
      wasMutating.current = false;
      if (current.group?.kind === 'card') refresh();
    }
  }, [mutating, current.group?.kind, refresh]);

  const open = (key: string) => {
    setSelected(key);
    if (key !== EMAIL_TEMPLATES) setTemplate(null);
    requestAnimationFrame(() => detailRef.current?.focus({ preventScroll: false }));
  };

  const env = registry.data?.environment;
  const counts = useMemo(() => {
    const g = registry.data?.groups ?? [];
    return { missing: g.filter((x) => x.status === 'missing').length, attention: g.filter((x) => x.status === 'env_fallback' || x.status === 'dev_default').length };
  }, [registry.data]);

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <PageHeader
        title="Config"
        description="Every key, token, secret, template and setting of the platform. Secrets are stored encrypted and never shown again; the panel wins over the server environment."
        meta={env ? <Chip tone={env === 'production' ? 'green' : 'amber'}>{env === 'production' ? 'Production' : env === 'test' ? 'Test server' : 'Development'}</Chip> : undefined}
        className="mb-1"
      />
      {registry.isError ? (
        <LoadError title="The config did not load" onRetry={() => void registry.refetch()} />
      ) : (
        <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
          <aside className="shrink-0 lg:w-64">
            <div className="lg:hidden">
              <label htmlFor="config-section" className="mb-1 block text-xs font-medium text-fg-secondary">
                Config section
              </label>
              <NativeSelect id="config-section" value={current.key} onChange={(e) => open(e.target.value)}>
                {sections.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.group ? `${s.label} (${GROUP_STATUS[s.group.status].label})` : s.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <nav aria-label="Config sections" className="hidden lg:block">
              {registry.isPending ? (
                <div className="flex flex-col gap-1.5" role="status" aria-label="Loading the config groups">
                  {Array.from({ length: 10 }, (_, i) => (
                    <Skeleton key={i} className="h-9 w-full" />
                  ))}
                </div>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {sections.map((s) => (
                    <li key={s.key}>
                      <SectionButton section={s} active={s.key === current.key} onClick={() => open(s.key)} />
                    </li>
                  ))}
                </ul>
              )}
              {!registry.isPending && (counts.missing > 0 || counts.attention > 0) && (
                <p className="mt-3 px-2 text-xs text-muted-strong" aria-live="polite">
                  {[counts.missing ? `${counts.missing} missing` : null, counts.attention ? `${counts.attention} need attention` : null].filter(Boolean).join(', ')}
                </p>
              )}
            </nav>
          </aside>
          <div ref={detailRef} tabIndex={-1} className="min-w-0 flex-1 focus:outline-none" aria-label={current.label} role="region">
            {registry.isPending && current.key !== GO_LIVE ? (
              <div className="flex flex-col gap-4" role="status" aria-label="Loading">
                <Skeleton className="h-72 w-full rounded-lg" />
                <Skeleton className="h-32 w-full rounded-lg" />
              </div>
            ) : (
              <SectionDetail section={current} template={template} onTemplate={setTemplate} onOpen={open} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionButton({ section: s, active, onClick }: { section: Section; active: boolean; onClick: () => void }) {
  const Icon = s.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      data-slot="subnav-item"
      className={cn(
        'focus-ring flex min-h-9 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
        'text-fg-secondary hover:bg-surface-3 hover:text-fg aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium aria-[current=page]:text-accent-soft-fg',
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{s.label}</span>
      {s.group && <GroupStatusDot status={s.group.status} />}
    </button>
  );
}

const DOT: Record<ConfigGroup['status'], string> = {
  configured: 'bg-success',
  missing: 'bg-danger',
  env_fallback: 'bg-warning',
  dev_default: 'bg-warning',
};

/** Compact status in the section list: a dot plus the text for screen readers and on hover. */
function GroupStatusDot({ status }: { status: ConfigGroup['status'] }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-2xs font-medium text-muted-strong" title={GROUP_STATUS[status].hint}>
      <span aria-hidden className={cn('size-2 rounded-full', DOT[status])} />
      <span className="hidden xl:inline">{GROUP_STATUS[status].label}</span>
      <span className="sr-only xl:hidden">{GROUP_STATUS[status].label}</span>
    </span>
  );
}

function CardSection({ group, children }: { group: ConfigGroup; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-fg">{group.label}</h2>
        <GroupStatusChip status={group.status} size="md" />
      </div>
      {group.status !== 'configured' && (
        <InlineAlert tone={group.status === 'missing' ? 'warning' : 'info'}>{group.statusNote ?? GROUP_STATUS[group.status].hint}</InlineAlert>
      )}
      {children}
      <GroupAudit group={group.key as ConfigGroupKey} />
    </div>
  );
}

function SectionDetail({ section: s, template, onTemplate, onOpen }: { section: Section; template: PlatformEmailTemplateKey | null; onTemplate: (k: PlatformEmailTemplateKey | null) => void; onOpen: (key: string) => void }) {
  if (s.key === GO_LIVE) return <GoLiveChecklistPanel onOpenGroup={onOpen} />;
  if (s.key === EMAIL_TEMPLATES) return <PlatformTemplates templateKey={template} onOpen={onTemplate} />;
  const g = s.group;
  if (!g) return null;
  if (g.kind === 'registry') return <RegistryGroupPanel group={g} />;
  switch (g.key) {
    case 'billing_profile':
      return (
        <CardSection group={g}>
          <VistarBillingProfileCard />
        </CardSection>
      );
    case 'razorpay':
      return (
        <CardSection group={g}>
          <RazorpayCard />
        </CardSection>
      );
    case 'firebase':
      return (
        <CardSection group={g}>
          <FirebaseCard />
        </CardSection>
      );
    case 'android_releases':
      return (
        <CardSection group={g}>
          <ReleasesCard />
        </CardSection>
      );
    default:
      return (
        <CardSection group={g}>
          <p className="text-sm text-muted-strong">{g.description}</p>
        </CardSection>
      );
  }
}
