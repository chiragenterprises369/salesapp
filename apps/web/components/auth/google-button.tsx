'use client';

import { useEffect, useRef, useState } from 'react';
import { authFailureFrom } from '@/lib/auth/actions';
import { usePublicPlatformInfo } from '@/lib/config/public';
import { useDocumentTheme } from '@/lib/use-document-theme';
import { useSessionStore } from '@/lib/session/session';
import { FormAlert, OrDivider } from './auth-frame';

/** Google Identity Services (loaded on demand from accounts.google.com; the CSP allows it). */
interface GoogleId {
  initialize(config: { client_id: string; callback: (r: { credential?: string }) => void; ux_mode?: 'popup'; auto_select?: boolean; cancel_on_tap_outside?: boolean; use_fedcm_for_button?: boolean }): void;
  renderButton(el: HTMLElement, options: { theme?: 'outline' | 'filled_black'; size?: 'large'; text?: 'continue_with' | 'signup_with' | 'signin_with'; shape?: 'rectangular'; width?: number; logo_alignment?: 'left' | 'center' }): void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let gisPromise: Promise<GoogleId> | null = null;

function loadGis(): Promise<GoogleId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  gisPromise ??= new Promise<GoogleId>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('Google sign-in did not start.')));
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('Google sign-in could not load. Check your connection or use your e-mail and password.'));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

/**
 * "Continue with Google" (change #20): shown only when the Super Admin configured the Google OAuth
 * client (GET /public/platform), with its own "or" divider. The Google credential goes to POST
 * /auth/google with the sign-up company name or the invite token when the page has one.
 */
export function GoogleButton({ label = 'continue_with', workspaceName, inviteToken, onBeforeSignIn }: { label?: 'continue_with' | 'signup_with' | 'signin_with'; workspaceName?: string; inviteToken?: string; onBeforeSignIn?: () => string | null }) {
  const info = usePublicPlatformInfo();
  const theme = useDocumentTheme();
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Latest props for the Google callback (registered once per client id).
  const extra = useRef({ workspaceName, inviteToken, onBeforeSignIn });
  useEffect(() => {
    extra.current = { workspaceName, inviteToken, onBeforeSignIn };
  }, [workspaceName, inviteToken, onBeforeSignIn]);
  const clientId = info.data?.googleSignIn ? info.data.googleClientId : null;

  useEffect(() => {
    if (!clientId || !ref.current) return;
    let cancelled = false;
    const el = ref.current;
    loadGis()
      .then((gis) => {
        if (cancelled) return;
        gis.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          cancel_on_tap_outside: true,
          use_fedcm_for_button: true,
          callback: (r) => {
            if (!r.credential) return;
            const blocked = extra.current.onBeforeSignIn?.() ?? null;
            if (blocked) {
              setError(blocked);
              return;
            }
            setError(null);
            useSessionStore
              .getState()
              .signInWithGoogle({ idToken: r.credential, workspaceName: extra.current.workspaceName?.trim() || undefined, inviteToken: extra.current.inviteToken })
              .catch((e: unknown) => setError(authFailureFrom(e).message));
          },
        });
        el.replaceChildren();
        gis.renderButton(el, { theme: theme === 'dark' ? 'filled_black' : 'outline', size: 'large', text: label, shape: 'rectangular', width: Math.min(400, Math.max(200, el.clientWidth)), logo_alignment: 'center' });
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Google sign-in could not load.'));
    return () => {
      cancelled = true;
    };
  }, [clientId, theme, label]);

  if (!clientId) return null;
  return (
    <>
      <OrDivider />
      <div className="flex flex-col gap-3">
        <div ref={ref} className="flex min-h-10 w-full justify-center" />
        {error && <FormAlert>{error}</FormAlert>}
      </div>
    </>
  );
}
