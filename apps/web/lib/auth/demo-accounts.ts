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

/** One account per role for the development "Demo accounts" list. */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = ROLE_ORDER.map((role) => {
  const e = SHAKTI.employees.find((x) => x.role === role)!;
  return { email: e.email, name: e.name, title: e.title, persona: role };
});

export const DEMO_SUPER_ADMIN = { email: SUPER_ADMIN_FIXTURE.email, name: SUPER_ADMIN_FIXTURE.name } as const;

/** Dev-only password shared by every seeded account (documented in the seed fixtures). */
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
