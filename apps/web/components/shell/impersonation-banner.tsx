'use client';

import type { ImpersonationInfo } from '@vistar/shared';
import { EyeOff, ShieldAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { formatCountdown, formatTimeIn } from '@/components/common/time';
import { useNow } from '@/components/common/use-now';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { toast } from '@/components/ui/toast';
import { SUPER_LOGIN_PATH } from '@/lib/auth/redirect';
import { useSignOut } from '@/lib/auth/use-auth';
import { useMe } from '@/lib/session/session';

/** CSS variable with the banner height (0 when not impersonating); overlays offset their top by it. */
export const BANNER_HEIGHT_VAR = '--impersonation-banner-h';

/**
 * Persistent banner while a Super Admin views the company ("View as company"). Sits above the shell
 * in normal flow with z-[70], so menus, drawers and dialog overlays (z-50) never cover it.
 */
export function ImpersonationBanner() {
  const me = useMe();
  if (!me?.impersonation) return null;
  return <Banner info={me.impersonation} workspaceName={me.workspace.name} timeZone={me.workspace.timezone} />;
}

function Banner({ info, workspaceName, timeZone }: { info: ImpersonationInfo; workspaceName: string; timeZone: string }) {
  const now = useNow(1_000);
  const signOut = useSignOut();
  const ended = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  const expiresAt = new Date(info.expiresAt).getTime();
  const remaining = now > 0 ? expiresAt - now : null;

  // Publish the banner height so drawers start below it (the banner must never be covered).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty(BANNER_HEIGHT_VAR, `${el.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty(BANNER_HEIGHT_VAR);
    };
  }, []);

  useEffect(() => {
    if (remaining === null || remaining > 0 || ended.current) return;
    ended.current = true;
    toast('Support session ended', { description: 'The time limit was reached.' });
    signOut(SUPER_LOGIN_PATH);
  }, [remaining, signOut]);

  const end = () => {
    ended.current = true;
    toast.success('Support session ended');
    signOut(SUPER_LOGIN_PATH);
  };

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Support session"
      className="relative z-[70] flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-status-amber-border bg-status-amber-bg px-4 py-2 text-sm text-status-amber-fg"
    >
      <ShieldAlert aria-hidden className="size-4 shrink-0" />
      <p className="min-w-0 flex-1 basis-64">
        <span className="font-semibold">{info.adminName}</span> from Tootodo support is viewing {workspaceName}.{' '}
        <span className="text-fg-secondary">Reason: {info.reason}</span>
      </p>
      <span className="flex flex-wrap items-center gap-2">
        {info.readOnly && <Chip tone="amber">Read-only</Chip>}
        {!info.contentAccess && (
          <Chip tone="grey">
            <EyeOff aria-hidden />
            Messages hidden
          </Chip>
        )}
        <span className="text-xs font-medium tabular" title={`Ends at ${formatTimeIn(info.expiresAt, timeZone)}`}>
          <span className="sr-only">Session ends at {formatTimeIn(info.expiresAt, timeZone)}. </span>
          <span aria-hidden>Ends in {remaining === null ? '--:--' : formatCountdown(remaining)}</span>
        </span>
        <Button size="sm" onClick={end}>
          End session
        </Button>
      </span>
    </div>
  );
}
