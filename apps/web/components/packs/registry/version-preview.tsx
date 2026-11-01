'use client';

import type { SuperPack } from '@vistar/shared';
import { useState } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { SettingsCard } from '@/components/settings/settings-card';
import { errorMessage, InlineAlert } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSuperPackVersion } from '@/lib/packs';
import { SUMMARY_TITLES } from './registry-meta';

/** Manifest of one version: item counts and the formatted JSON (collapsed). */
export function VersionPreview({ pack }: { pack: SuperPack }) {
  const versions = [...pack.versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [version, setVersion] = useState(pack.latestVersion);
  const q = useSuperPackVersion(pack.key, version);
  const selectId = `pack-version-${pack.key}`;

  return (
    <SettingsCard title="Version preview" description="What installing this version adds to a company.">
      <div className="flex flex-col gap-3">
        {versions.length > 1 && (
          <div className="max-w-xs">
            <label htmlFor={selectId} className="mb-1 block text-xs font-medium text-fg-secondary">
              Version
            </label>
            <NativeSelect id={selectId} value={version} onChange={(e) => setVersion(e.target.value)}>
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version}
                  {v.version === pack.latestVersion ? ' (latest)' : ''}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {q.isPending ? (
          <div aria-busy="true" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <span role="status" className="sr-only">
              Loading version {version}
            </span>
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : q.isError ? (
          <InlineAlert title="Version did not load">
            {errorMessage(q.error)}
            <div className="mt-2">
              <Button size="sm" onClick={() => void q.refetch()}>
                Try again
              </Button>
            </div>
          </InlineAlert>
        ) : (
          <>
            <p className="text-xs text-muted">
              Version {q.data.version} · checksum <code className="font-mono">{q.data.checksum}</code>
            </p>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(q.data.summary).map(([k, n]) => (
                <div key={k} className="rounded-md border border-border bg-surface-2 px-3 py-2">
                  <dt className="text-2xs text-muted-strong">{SUMMARY_TITLES[k] ?? k}</dt>
                  <dd className="text-base font-semibold text-fg tabular">{n}</dd>
                </div>
              ))}
            </dl>
            <details className="rounded-md border border-border">
              <summary className="focus-ring flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm font-medium text-fg-secondary hover:text-fg">Manifest JSON</summary>
              <pre
                tabIndex={0}
                aria-label={`Manifest of ${pack.name} ${q.data.version}`}
                className="focus-ring max-h-96 overflow-auto border-t border-border bg-surface-2 p-3 font-mono text-2xs leading-relaxed text-fg"
              >
                {JSON.stringify(q.data.manifest, null, 2)}
              </pre>
            </details>
          </>
        )}
      </div>
    </SettingsCard>
  );
}
