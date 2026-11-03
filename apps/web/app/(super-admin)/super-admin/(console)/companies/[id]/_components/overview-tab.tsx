'use client';

import { FEATURE_FLAGS, formatInr, formatNumber, type ChipTone, type Company, type CustomDomainStatus, type Plan, type WorkspaceStatus } from '@vistar/shared';
import { Building, CheckCircle2, CircleSlash, Globe } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatDateTimeIn } from '@/components/common/time';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { FLAG_LABEL } from '@/lib/world/platform';
import { REQUEST_STATUS_LABEL } from '../../../floors/_components/status';
import type { CompanyTab } from './tabs';
import { CompanySetupCard } from './setup-card';

export const TZ = 'Asia/Kolkata';
export const when = (iso: string | null | undefined) => (iso ? formatDateTimeIn(iso, TZ) : '–');

export const PLAN_LABEL: Record<Plan, string> = { free: 'Free', starter: 'Starter', growth: 'Growth', enterprise: 'Enterprise' };
export const STATUS_CHIP: Record<WorkspaceStatus, { text: string; tone: ChipTone }> = {
  active: { text: 'Active', tone: 'green' },
  trial: { text: 'Trial', tone: 'blue' },
  suspended: { text: 'Suspended', tone: 'amber' },
  deleted: { text: 'Deleted', tone: 'grey' },
};
const DOMAIN_CHIP: Record<CustomDomainStatus, { text: string; tone: ChipTone }> = {
  pending: { text: 'Waiting for DNS', tone: 'amber' },
  verified: { text: 'Verified', tone: 'green' },
  failed: { text: 'Check failed', tone: 'red' },
};

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate text-sm font-medium text-fg">{children}</dd>
    </div>
  );
}

const storage = (mb: number) => (mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10} GB` : `${formatNumber(mb)} MB`);

export function CompanyOverviewTab({ company: c, onOpenTab }: { company: Company; onOpenTab: (t: CompanyTab) => void }) {
  const domainStatus = c.customDomain ? DOMAIN_CHIP[c.customDomain.status] : null;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Company</CardTitle>
            <CardDescription>Plan, status and activity.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3">
            <Fact label="Plan">{PLAN_LABEL[c.plan]}</Fact>
            <Fact label="Status">{STATUS_CHIP[c.status].text}</Fact>
            <Fact label="Monthly revenue">{c.mrrInr ? formatInr(c.mrrInr) : 'Free'}</Fact>
            <Fact label="Trial ends">{c.trialEndsAt ? when(c.trialEndsAt) : '–'}</Fact>
            <Fact label="Users">{formatNumber(c.userCount ?? c.usage.seats)}</Fact>
            <Fact label="Owner">{c.ownerEmail ?? '–'}</Fact>
            <Fact label="Created">{when(c.createdAt)}</Fact>
            <Fact label="Last active">{when(c.lastActiveAt)}</Fact>
            <Fact label="Workspace id">
              <span className="font-mono text-xs">{c.id}</span>
            </Fact>
            <Fact label="Slug">
              <span className="font-mono text-xs">{c.slug}</span>
            </Fact>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Usage this period</CardTitle>
            <CardDescription>{`Metering for ${c.usage.period}. Limits and overage are on the Plan and billing tab.`}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3">
            <Fact label="Seats">{formatNumber(c.usage.seats)}</Fact>
            <Fact label="Leads">{formatNumber(c.usage.leads)}</Fact>
            <Fact label="WhatsApp messages">{formatNumber(c.usage.whatsappMessages)}</Fact>
            <Fact label="Workflow runs">{formatNumber(c.usage.workflowRuns)}</Fact>
            <Fact label="Storage">{storage(c.usage.storageMb)}</Fact>
          </dl>
          <Button variant="link" className="mt-3 h-auto px-0" onClick={() => onOpenTab('billing')}>
            Open plan and billing
          </Button>
        </CardContent>
      </Card>

      <CompanySetupCard company={c} />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Features</CardTitle>
            <CardDescription>Effective flags: the plan defaults plus your overrides.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2" aria-label="Features">
            {FEATURE_FLAGS.map((f) => {
              const on = c.features ? c.features[f] : (c.flagOverrides[f] ?? false);
              const overridden = c.flagOverrides[f] !== undefined;
              return (
                <li key={f} className="flex min-w-0 items-center gap-2 text-sm">
                  {on ? <CheckCircle2 aria-hidden className="size-4 shrink-0 text-success-text" /> : <CircleSlash aria-hidden className="size-4 shrink-0 text-muted" />}
                  <span className={on ? 'truncate text-fg' : 'truncate text-muted-strong'}>{FLAG_LABEL[f]}</span>
                  <span className="sr-only">{on ? 'on' : 'off'}</span>
                  {overridden && <Chip tone="amber">Override</Chip>}
                </li>
              );
            })}
          </ul>
          <Button variant="link" className="mt-3 h-auto px-0" onClick={() => onOpenTab('switches')}>
            Change switches
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Custom domain</CardTitle>
            <CardDescription>The company sets it in Settings, Domain once the switch is on.</CardDescription>
          </div>
          <Globe aria-hidden className="size-4 text-fg-secondary" />
        </CardHeader>
        <CardContent>
          {c.customDomain ? (
            <dl className="grid grid-cols-2 gap-3">
              <Fact label="Hostname">
                <span className="font-mono text-xs">{c.customDomain.hostname}</span>
              </Fact>
              <Fact label="Status">
                {domainStatus ? (
                  <Chip tone={domainStatus.tone} dot>
                    {domainStatus.text}
                  </Chip>
                ) : (
                  c.customDomain.status
                )}
              </Fact>
            </dl>
          ) : (
            <p className="text-sm text-muted-strong">{c.features?.custom_domain ? 'Switched on; the company has not added a domain yet.' : 'Off for this company.'}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Team Floor</CardTitle>
            <CardDescription>Custom floor request and the published version.</CardDescription>
          </div>
          <Building aria-hidden className="size-4 text-fg-secondary" />
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3">
            <Fact label="Latest request">{c.floor?.requestStatus ? REQUEST_STATUS_LABEL[c.floor.requestStatus] : 'None'}</Fact>
            <Fact label="Published version">{c.floor?.publishedVersion ? `Version ${c.floor.publishedVersion}` : 'Default template'}</Fact>
          </dl>
          <Button variant="link" className="mt-3 h-auto px-0" onClick={() => onOpenTab('floor')}>
            Open floor requests
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
