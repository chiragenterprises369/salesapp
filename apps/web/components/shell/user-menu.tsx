'use client';

import { initials } from '@vistar/shared';
import { Building2, FlaskConical, LogOut, Smartphone, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/common/menu';
import { Avatar } from '@/components/ui/avatar';
import { Chip } from '@/components/ui/chip';
import { SUPER_LOGIN_PATH } from '@/lib/auth/redirect';
import { useSignOut, useSwitchPersona } from '@/lib/auth/use-auth';
import { currentPersona, MOCK_PERSONAS, useSession, type MockPersona } from '@/lib/session/session';
import { cn } from '@/lib/cn';

const isDev = process.env.NODE_ENV !== 'production';

const PERSONA_LABEL: Record<MockPersona, string> = {
  company_admin: 'Company admin (Anil)',
  manager: 'Manager (Priya)',
  employee: 'Employee (Rohit)',
  viewer: 'Viewer (Deepa)',
  super_admin: 'Super Admin',
};

/**
 * Avatar menu for every panel: who am I, profile, panel switch for managers, sign out, and (development
 * only) a persona switcher for testing roles.
 */
export function UserMenu({ panel, triggerClassName }: { panel: 'company' | 'employee' | 'super-admin'; triggerClassName?: string }) {
  const session = useSession();
  const router = useRouter();
  const signOut = useSignOut();
  const switchPersona = useSwitchPersona();
  if (!session) return null;

  const persona = currentPersona(session);
  const impersonating = session.audience === 'workspace' && !!session.me.impersonation;
  const name = session.audience === 'workspace' ? session.me.user.name : session.admin.name;
  const email = session.audience === 'workspace' ? session.me.user.email : session.admin.email;
  const roleLabel = session.audience === 'workspace' ? session.me.role.name : 'Super Admin';
  const kind = session.audience === 'workspace' ? session.me.role.kind : null;
  const status = session.audience === 'workspace' ? session.me.user.status : undefined;
  const profileHref = panel === 'employee' ? '/me/profile' : panel === 'company' ? '/app/profile' : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // Starts with the visible initials so voice users can say what they see (WCAG 2.5.3).
        aria-label={`${initials(name)}, account menu for ${name}`}
        className={cn('focus-ring inline-flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-surface-3', triggerClassName)}
      >
        <Avatar name={name} size="md" status={panel === 'super-admin' ? undefined : status} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <Avatar name={name} size="lg" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-fg">{name}</p>
            <p className="truncate text-xs text-muted">{email}</p>
            <Chip tone={panel === 'super-admin' ? 'indigo' : 'neutral'} className="mt-1">
              {roleLabel}
            </Chip>
          </div>
        </div>
        <DropdownMenuSeparator />
        {profileHref && (
          <DropdownMenuItem onSelect={() => router.push(profileHref)}>
            <UserRound aria-hidden />
            Profile and preferences
          </DropdownMenuItem>
        )}
        {kind === 'manager' && panel === 'company' && (
          <DropdownMenuItem onSelect={() => router.push('/me')}>
            <Smartphone aria-hidden />
            Open my workspace
          </DropdownMenuItem>
        )}
        {kind === 'manager' && panel === 'employee' && (
          <DropdownMenuItem onSelect={() => router.push('/app')}>
            <Building2 aria-hidden />
            Open company panel
          </DropdownMenuItem>
        )}
        {isDev && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FlaskConical aria-hidden />
              Switch persona (dev)
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-60">
              <DropdownMenuLabel>Development only</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={impersonating ? 'impersonating' : (persona ?? '')}>
                {MOCK_PERSONAS.map((p) => (
                  <DropdownMenuRadioItem key={p} value={p} onSelect={() => switchPersona(p)}>
                    {PERSONA_LABEL[p]}
                  </DropdownMenuRadioItem>
                ))}
                <DropdownMenuRadioItem value="impersonating" onSelect={() => switchPersona('company_admin', { impersonating: true })}>
                  Company admin, support session
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut(panel === 'super-admin' || impersonating ? SUPER_LOGIN_PATH : undefined)}>
          <LogOut aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
