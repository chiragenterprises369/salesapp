'use client';

import { SUPER_SESSION } from '@vistar/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatCountdown } from '@/components/common/time';
import { useNow } from '@/components/common/use-now';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { SUPER_LOGIN_PATH } from '@/lib/auth/redirect';
import { useSignOut } from '@/lib/auth/use-auth';

const KEY_LAST_ACTIVITY = 'vistar.super.lastActivity';
const WARN_BEFORE_MS = 2 * 60_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'] as const;

/** Dev only: `?idleSec=90` shortens the timeout to test the warning and sign-out. */
function timeoutMs(): number {
  if (process.env.NODE_ENV !== 'production') {
    const sec = Number(new URLSearchParams(window.location.search).get('idleSec'));
    if (Number.isFinite(sec) && sec >= 10) return sec * 1000;
  }
  return SUPER_SESSION.idleTimeoutSec * 1000;
}

function readShared(): number {
  try {
    return Number(window.localStorage.getItem(KEY_LAST_ACTIVITY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Super Admin idle timeout (SUPER_SESSION.idleTimeoutSec = 30 min): warns 2 minutes before, then
 * signs out. Activity in any console tab counts (shared through localStorage). The API enforces the
 * same limit on the refresh token.
 */
export function IdleTimeout() {
  const signOut = useSignOut();
  const [limit, setLimit] = useState(SUPER_SESSION.idleTimeoutSec * 1000);
  const [lastActivity, setLastActivity] = useState(0);
  const warningRef = useRef(false);
  const doneRef = useRef(false);
  const now = useNow(1_000);

  const touch = useCallback(() => {
    const t = Date.now();
    setLastActivity(t);
    try {
      window.localStorage.setItem(KEY_LAST_ACTIVITY, String(t));
    } catch {
      /* ignore */
    }
  }, []);

  // Start the clock on mount and record activity (throttled), unless the warning is showing.
  useEffect(() => {
    const start = window.setTimeout(() => {
      setLimit(timeoutMs());
      touch();
    }, 0);
    let last = 0;
    const onActivity = () => {
      if (warningRef.current) return;
      const t = Date.now();
      if (t - last < 5_000) return;
      last = t;
      touch();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_LAST_ACTIVITY && e.newValue) setLastActivity((prev) => Math.max(prev, Number(e.newValue) || 0));
    };
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    window.addEventListener('storage', onStorage);
    return () => {
      window.clearTimeout(start);
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity));
      window.removeEventListener('storage', onStorage);
    };
  }, [touch]);

  const since = lastActivity > 0 && now > 0 ? Math.max(lastActivity, readShared()) : 0;
  const remaining = since ? limit - (now - since) : limit;
  const warn = since > 0 && remaining <= Math.min(WARN_BEFORE_MS, limit / 2) && remaining > 0;

  useEffect(() => {
    warningRef.current = warn;
  }, [warn]);

  useEffect(() => {
    if (!since || remaining > 0 || doneRef.current) return;
    doneRef.current = true;
    toast(`Signed out after ${Math.round(limit / 60_000) || 1} minutes without activity`);
    signOut(`${SUPER_LOGIN_PATH}?reason=idle`);
  }, [since, remaining, limit, signOut]);

  return (
    <Dialog open={warn} onOpenChange={(open) => !open && touch()}>
      <DialogContent size="sm" hideClose onEscapeKeyDown={() => touch()}>
        <DialogHeader>
          <DialogTitle>Still there?</DialogTitle>
          <DialogDescription>For security, the platform console signs you out after {SUPER_SESSION.idleTimeoutSec / 60} minutes without activity.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-fg-secondary" aria-live="polite">
            Signing out in <span className="font-semibold tabular">{formatCountdown(remaining)}</span>
          </p>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => signOut(SUPER_LOGIN_PATH)}>Sign out now</Button>
          <Button variant="primary" onClick={touch} autoFocus>
            Stay signed in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
