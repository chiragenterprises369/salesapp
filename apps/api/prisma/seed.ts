/**
 * CLEAN seed (D-064, SPEC 29.8). Run: pnpm db:seed. In production (change #20, P6) it needs SEED_SUPER_ADMIN_EMAIL and
 * SEED_SUPER_ADMIN_PASSWORD (12+ characters) and never uses the dev fixture account. For the local main database:
 * no companies, no demo data. Companies are created from the Super Admin panel (POST /api/super/companies) or by
 * sign-up. The demo companies are in prisma/seed-demo.ts (pnpm db:seed:demo).
 *
 * Writes, idempotently and without deleting anything:
 *  - the plan catalogue (prices, limits, feature flags: custom_domain off everywhere, field_tracking on growth and
 *    enterprise);
 *  - one Super Admin (SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD, default the dev fixture); an existing
 *    account keeps its password and 2FA; 2FA is enrolled on first login;
 *  - the Industry Pack registry (packs/<key>/manifest.json), so new companies get the core pack.
 * Firebase files and APK releases are uploaded in the Super Admin config section, not seeded.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PLATFORM_PERMISSIONS } from '@vistar/shared';
import { SEED_WORKSPACE, SUPER_ADMIN_FIXTURE } from '@vistar/shared/fixtures';
import argon2 from 'argon2';
import { config } from 'dotenv';
import path from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { syncRegistry } from '../src/modules/packs/pack-registry.js';
import { PLAN_CATALOGUE, seedDatabaseUrl, upsertPlans } from './seed/base.js';

config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

async function main() {
  // ---- change #20: config (P6). Production: the first Super Admin comes from the env (no dev fixture, no dev password).
  const production = process.env.NODE_ENV === 'production';
  if (production) {
    const missing = ['SEED_SUPER_ADMIN_EMAIL', 'SEED_SUPER_ADMIN_PASSWORD'].filter((k) => !process.env[k]?.trim());
    if (missing.length) {
      console.error(`Refusing to seed production without ${missing.join(' and ')} (the dev fixture account is never created in production).`);
      process.exit(1);
    }
    if (process.env.SEED_SUPER_ADMIN_PASSWORD!.length < 12) {
      console.error('Refusing to seed production: SEED_SUPER_ADMIN_PASSWORD must be at least 12 characters.');
      process.exit(1);
    }
  }
  // ---- end change #20: config
  const url = seedDatabaseUrl({ allowProduction: true });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const t0 = Date.now();
  const email = (process.env.SEED_SUPER_ADMIN_EMAIL || SUPER_ADMIN_FIXTURE.email).toLowerCase();
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD || SEED_WORKSPACE.devPassword;
  if (password.length < 10) throw new Error('SEED_SUPER_ADMIN_PASSWORD must be at least 10 characters');

  try {
    await upsertPlans(prisma);

    const existing = await prisma.platformAdmin.findUnique({ where: { email }, select: { id: true } });
    let adminLine: string;
    if (existing) {
      // Keep the password and 2FA; make sure the owner still has every platform permission.
      await prisma.platformAdmin.update({ where: { id: existing.id }, data: { permissions: [...PLATFORM_PERMISSIONS], isActive: true } });
      adminLine = `  Super Admin   ${email} (existing account kept: password and 2FA unchanged)`;
    } else {
      await prisma.platformAdmin.create({ data: { email, name: SUPER_ADMIN_FIXTURE.name, passwordHash: await argon2.hash(password), permissions: [...PLATFORM_PERMISSIONS] } });
      adminLine = `  Super Admin   ${email}  -> /super-admin (enrol 2FA on first login)${process.env.SEED_SUPER_ADMIN_PASSWORD ? '' : ` password "${password}" (dev default)`}`;
    }

    const registry = await syncRegistry(prisma);
    const [companies, users] = await Promise.all([prisma.workspace.count({ where: { deletedAt: null } }), prisma.user.count()]);
    const seconds = ((Date.now() - t0) / 1000).toFixed(1);

    console.info(`Seeded (clean) in ${seconds}s`);
    console.info(`  Plans         ${PLAN_CATALOGUE.map((p) => p.key).join(', ')}`);
    console.info(adminLine);
    console.info(`  Pack registry ${registry.packs.map((p) => `${p.key}@${p.version}`).join(', ') || '(none)'}`);
    console.info(`  Companies     ${companies} (${users} users)${companies ? ' already in this database; the clean seed never deletes data' : ': create them in the Super Admin panel or by sign-up'}`);
    console.info('  Demo data     pnpm db:seed:demo (worktree databases, smoke, e2e)');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
