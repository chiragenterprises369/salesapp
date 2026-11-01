'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useDocumentTheme } from '@/lib/use-document-theme';
import { MOCK_PERSONAS, useSessionActions, useSessionStatus, type MockPersona } from '@/lib/session/session';

/**
 * Dev preview frame for feature tracks (orchestrator-owned). Signs in a mock persona if nobody is
 * signed in, and offers a theme toggle that does not depend on the app shell.
 */
export function DevFrame({ title, persona = 'manager', children }: { title: string; persona?: MockPersona; children: ReactNode }) {
  const status = useSessionStatus();
  const { signInMock } = useSessionActions();
  const theme = useDocumentTheme();

  useEffect(() => {
    if (status === 'unauthenticated') signInMock(persona);
  }, [status, persona, signInMock]);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.style.colorScheme = next;
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4">
        <h1 className="text-sm font-semibold">Dev preview: {title}</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Personas: {MOCK_PERSONAS.join(', ')} (use ?mockAs=)</span>
          <Button size="sm" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            {theme === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
            {theme === 'dark' ? 'Light' : 'Dark'}
          </Button>
        </div>
      </header>
      <main className="min-h-0 flex-1 p-4">{status === 'authenticated' ? children : null}</main>
    </div>
  );
}
