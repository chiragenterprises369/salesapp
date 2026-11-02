'use client';

import type { CustomDomain, CustomDomainStatus } from '@vistar/shared';
import { AlertCircle, CheckCircle2, Copy, Globe, Info, RefreshCw, RotateCw, ShieldAlert, Trash2 } from 'lucide-react';
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { formatDateTimeIn } from '@/components/common/time';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FormField, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { useCustomDomain, validateHostname } from '@/lib/branding/custom-domain';
import { errorMessage } from '@/lib/branding/http';
import { useMe } from '@/lib/session/session';
import { SettingsCard } from './settings-card';

const noopSubscribe = () => () => {};

const STATUS: Record<CustomDomainStatus, { label: string; tone: 'amber' | 'green' | 'red' }> = {
  pending: { label: 'Waiting for DNS', tone: 'amber' },
  verified: { label: 'Verified', tone: 'green' },
  failed: { label: 'Not verified', tone: 'red' },
};

function CopyValue({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <code className="min-w-0 truncate rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg">{value}</code>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Copy ${label}`}
        onClick={() =>
          void navigator.clipboard?.writeText(value).then(
            () => toast.success(`${label} copied`),
            () => toast.error('Copy did not work. Select the text and copy it.'),
          )
        }
      >
        <Copy aria-hidden />
      </Button>
    </span>
  );
}

function DnsRecords({ domain }: { domain: CustomDomain }) {
  const rows = [
    { type: 'CNAME', name: domain.dns.cname.name, value: domain.dns.cname.value, why: 'Sends visitors of this address to Vistar.' },
    { type: 'TXT', name: domain.dns.txt.name, value: domain.dns.txt.value, why: 'Proves that your company owns the domain.' },
  ];
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm" aria-label="DNS records to add">
        <thead>
          <tr>
            {['Type', 'Name (host)', 'Value (points to)', 'Why'].map((h) => (
              <th key={h} scope="col" className="h-8 border-b border-border bg-surface-2 px-3 text-left text-xs font-medium text-muted-strong">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.type}>
              <td className="border-b border-border px-3 py-2 align-middle font-mono text-xs font-semibold text-fg">{r.type}</td>
              <td className="max-w-64 border-b border-border px-3 py-2 align-middle">
                <CopyValue value={r.name} label={`${r.type} name`} />
              </td>
              <td className="max-w-72 border-b border-border px-3 py-2 align-middle">
                <CopyValue value={r.value} label={`${r.type} value`} />
              </td>
              <td className="border-b border-border px-3 py-2 align-middle text-xs text-muted">{r.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LocalTestCard({ hostname, port }: { hostname: string | null; port: string }) {
  const host = hostname?.endsWith('.localhost') ? hostname : 'shakti.localhost';
  return (
    <SettingsCard title="Test it on this computer" description="Before you change real DNS." className="h-fit">
      <ol className="flex list-decimal flex-col gap-2 pl-4 text-sm text-fg-secondary">
        <li>
          Use a name that ends in <code className="font-mono text-xs text-fg">.localhost</code>, for example <code className="font-mono text-xs text-fg">shakti.localhost</code>. Browsers send
          every <code className="font-mono text-xs text-fg">*.localhost</code> name to this computer, so no DNS record is needed.
        </li>
        <li>Press Connect domain, then Verify: local names verify at once.</li>
        <li>
          Sign out and open{' '}
          <code className="font-mono text-xs text-fg">
            http://{host}
            {port ? `:${port}` : ''}/login
          </code>
          . The sign-in page shows your logo, colour and image.
        </li>
      </ol>
      <p className="mt-3 flex items-start gap-2 text-xs text-muted-strong">
        <Info aria-hidden className="mt-px size-3.5 shrink-0" />
        Real domains need both records. Keep the TXT record after verifying: Vistar checks it again before renewing the certificate.
      </p>
    </SettingsCard>
  );
}

/**
 * Settings > Domain (SPEC 29.4): hostname, the CNAME and TXT records to add at the DNS provider,
 * Verify and the status. Only when the Super Admin enabled custom domains for this company.
 */
export function CustomDomainSettings() {
  const me = useMe()!;
  const { reason } = useReadOnly();
  const { query, enabled, domain, setHostname, verify, remove } = useCustomDomain();
  const [input, setInput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const port = useSyncExternalStore(noopSubscribe, () => window.location.port, () => '');
  const value = input ?? domain?.hostname ?? '';

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-36 w-full rounded-lg" />
        <Skeleton className="h-52 w-full rounded-lg" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        icon={<AlertCircle />}
        title="Domain settings did not load"
        description="Check your connection, then try again."
        action={
          <Button onClick={() => void query.refetch()}>
            <RotateCw aria-hidden />
            Try again
          </Button>
        }
      />
    );
  }
  if (!enabled) {
    return (
      <EmptyState
        icon={<Globe />}
        title="Custom domains are not turned on for your company"
        description="Vistar support switches this on per company. Ask them to enable a custom domain, then come back here to connect it."
      />
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const v = validateHostname(value);
    setInput(v.hostname);
    if (v.error) {
      setError(v.error);
      return;
    }
    setError(null);
    try {
      await setHostname.mutateAsync(v.hostname);
      setInput(null);
      toast.success(`Add the two DNS records for ${v.hostname}, then press Verify`);
    } catch (err) {
      setError(errorMessage(err, 'Domain not saved. Check your connection and try again.'));
    }
  }

  async function onVerify() {
    try {
      const next = await verify.mutateAsync();
      if (next.domain?.status === 'verified') toast.success(`${next.domain.hostname} is connected`);
      else toast.error('Not verified yet. Check the TXT record and try again later.');
    } catch (err) {
      toast.error(errorMessage(err, 'The check did not run. Try again.'));
    }
  }

  async function onRemove() {
    try {
      await remove.mutateAsync();
      setInput('');
      toast.success('Custom domain removed. Vistar keeps working on its own address.');
    } catch (err) {
      toast.error(errorMessage(err, 'The domain was not removed. Try again.'));
    }
  }

  const status = domain ? STATUS[domain.status] : null;
  const changed = !!domain && value.trim().toLowerCase() !== domain.hostname;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] 3xl:grid-cols-[minmax(0,1fr)_minmax(0,40rem)]">
      <div className="flex min-w-0 flex-col gap-4">
        <form onSubmit={onSubmit} noValidate>
          <SettingsCard title="Address" description="The sub-domain your team will open. You keep using your own DNS provider.">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <FormField label="Hostname" error={error ?? undefined} hint="For example crm.yourcompany.com, or shakti.localhost to try it on this computer." className="flex-1">
                <Input value={value} onChange={(e) => setInput(e.target.value)} placeholder="crm.yourcompany.com" autoComplete="off" spellCheck={false} disabled={!!reason} inputMode="url" />
              </FormField>
              <Button type="submit" variant={domain ? 'secondary' : 'primary'} loading={setHostname.isPending} disabled={!!reason || (!!domain && !changed)} className="sm:mt-[1.375rem]">
                {domain ? 'Change address' : 'Connect domain'}
              </Button>
            </div>
          </SettingsCard>
        </form>

        {domain && status && (
          <SettingsCard
            title="DNS records"
            description="Add both records at your domain provider (GoDaddy, Cloudflare, Hostinger and others), then verify. Changes can take from minutes up to 48 hours."
            footer={
              <>
                <p className="mr-auto text-xs text-muted-strong" aria-live="polite">
                  {domain.lastCheckedAt ? `Last checked ${formatDateTimeIn(domain.lastCheckedAt, me.workspace.timezone)}` : 'Not checked yet'}
                </p>
                <Button variant="ghost" onClick={() => void onRemove()} loading={remove.isPending} disabled={!!reason}>
                  <Trash2 aria-hidden />
                  Remove
                </Button>
                <Button variant="primary" onClick={() => void onVerify()} loading={verify.isPending} disabled={!!reason}>
                  <RefreshCw aria-hidden />
                  Verify
                </Button>
              </>
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-medium text-fg">{domain.hostname}</span>
              <Chip tone={status.tone} dot size="md">
                {verify.isPending ? 'Checking' : status.label}
              </Chip>
            </div>
            <DnsRecords domain={domain} />
            {domain.status === 'failed' && domain.lastError && (
              <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-danger-text">
                <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                {domain.lastError}
              </p>
            )}
            {domain.status === 'verified' && (
              <p className="mt-3 flex items-start gap-2 text-sm text-success-text">
                <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
                Connected. {domain.hostname} opens your workspace, and the sign-in page there shows your branding.
              </p>
            )}
          </SettingsCard>
        )}
      </div>
      <LocalTestCard hostname={domain?.hostname ?? null} port={port} />
    </div>
  );
}
