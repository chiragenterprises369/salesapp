import type { RoleKind } from '@vistar/shared';
import { COMPANY_FIXTURES, SEED_WORKSPACE, SUPER_ADMIN_FIXTURE } from '@vistar/shared/fixtures';
import type { MockPersona } from '@/lib/session/session';

/**
 * Wave 1 mock sign-in: Shakti fixture emails map to a mock persona by role
 * (anil = company admin, priya and gurpreet = manager, every sales rep = employee, deepa = viewer).
 * Each role has ONE mock identity (lib/session), so e.g. any employee email signs in as Rohit Verma.
 * Replaced by POST /auth/login in Wave 3.
 */
const SHAKTI = COMPANY_FIXTURES[0]!;

export interface DemoAccount {
  email: string;
  name: string;
  title: string;
  persona: MockPersona;
}

const ROLE_ORDER: RoleKind[] = ['company_admin', 'manager', 'employee', 'viewer'];

/**
 * One-click demo sign-in on /login: development builds, and the demo site's build (demo.crm.tootodo.com,
 * Vercel project salesapp-demo, built with NEXT_PUBLIC_DEMO_LOGIN=1). Production (crm.tootodo.com) never sets
 * the flag: the demo accounts exist only in the demo database.
 */
export const DEMO_LOGIN_ENABLED: boolean =
  process.env.NEXT_PUBLIC_DEMO_LOGIN === '1' || process.env.NODE_ENV !== 'production';

/** One account per role (Shakti Industries) for the demo sign-in buttons. */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = ROLE_ORDER.map((role) => {
  const e = SHAKTI.employees.find((x) => x.role === role)!;
  return { email: e.email, name: e.name, title: e.title, persona: role };
});

export const DEMO_SUPER_ADMIN = { email: SUPER_ADMIN_FIXTURE.email, name: SUPER_ADMIN_FIXTURE.name } as const;

/** Password of every account the demo seed creates (`pnpm db:seed:demo`; public, docs/DEMO.md). */
export const DEMO_PASSWORD: string = SEED_WORKSPACE.devPassword;

export const DEMO_WORKSPACE_NAME: string = SHAKTI.name;

/** Workspace persona for a Shakti email, or null when the email is not a demo account. */
export function personaForEmail(email: string): RoleKind | null {
  const e = SHAKTI.employees.find((x) => x.email === email.trim().toLowerCase());
  return e ? e.role : null;
}

export function isSuperAdminEmail(email: string): boolean {
  return email.trim().toLowerCase() === SUPER_ADMIN_FIXTURE.email;
}
